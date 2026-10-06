# webchat

Realtime chat with a Go WebSocket server and a Next.js UI.

## Run

Terminal 1 — backend:

```bash
cd server
go run .
```

Terminal 2 — frontend:

```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The UI connects to `ws://localhost:8080/ws`.

Optional: set `NEXT_PUBLIC_WS_URL` in `web/.env.local` if the backend is elsewhere.
