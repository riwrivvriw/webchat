package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const maxNameLen = 24
const maxTextLen = 2000

type incoming struct {
	Type string `json:"type"`
	Name string `json:"name"`
	Text string `json:"text"`
}

type outgoing struct {
	Type  string   `json:"type"`
	Name  string   `json:"name,omitempty"`
	Text  string   `json:"text,omitempty"`
	Time  int64    `json:"time"`
	Users []string `json:"users,omitempty"`
}

type client struct {
	hub  *hub
	conn *websocket.Conn
	send chan []byte
	name string
}

type hub struct {
	mu         sync.RWMutex
	clients    map[*client]struct{}
	broadcast  chan []byte
	register   chan *client
	unregister chan *client
}

func newHub() *hub {
	return &hub{
		clients:    make(map[*client]struct{}),
		broadcast:  make(chan []byte, 64),
		register:   make(chan *client),
		unregister: make(chan *client),
	}
}

func (h *hub) names() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]string, 0, len(h.clients))
	for c := range h.clients {
		if c.name != "" {
			out = append(out, c.name)
		}
	}
	return out
}

func (h *hub) emit(msg outgoing) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.broadcast <- b
}

func (h *hub) run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = struct{}{}
			h.mu.Unlock()
		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
			if c.name != "" {
				h.emit(outgoing{
					Type:  "system",
					Text:  c.name + " left",
					Time:  time.Now().UnixMilli(),
					Users: h.names(),
				})
			}
		case msg := <-h.broadcast:
			h.mu.RLock()
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					go func(cl *client) { h.unregister <- cl }(c)
				}
			}
			h.mu.RUnlock()
		}
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func (c *client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(4096)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var in incoming
		if err := json.Unmarshal(raw, &in); err != nil {
			continue
		}
		switch in.Type {
		case "join":
			name := clip(in.Name, maxNameLen)
			if name == "" {
				name = "anon"
			}
			c.hub.mu.Lock()
			c.name = name
			c.hub.mu.Unlock()
			c.hub.emit(outgoing{
				Type:  "system",
				Text:  name + " joined",
				Time:  time.Now().UnixMilli(),
				Users: c.hub.names(),
			})
		case "chat":
			if c.name == "" {
				continue
			}
			text := clip(in.Text, maxTextLen)
			if text == "" {
				continue
			}
			c.hub.emit(outgoing{
				Type: "chat",
				Name: c.name,
				Text: text,
				Time: time.Now().UnixMilli(),
			})
		}
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(50 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func clip(s string, n int) string {
	runes := []rune(s)
	if len(runes) > n {
		return string(runes[:n])
	}
	return s
}

func main() {
	h := newHub()
	go h.run()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("upgrade:", err)
			return
		}
		c := &client{
			hub:  h,
			conn: conn,
			send: make(chan []byte, 32),
		}
		h.register <- c
		go c.writePump()
		go c.readPump()
	})

	addr := ":8080"
	log.Println("websocket server on", addr)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
