# whoport

## What annoyed me

I start a Nest service and get `EADDRINUSE: port 3000`. Then I copy a PID out of `netstat` and try to work out whether it's a stale `ts-node` from another repo or something I still need. `kill-port` just kills it. What I wanted to know was *what* holds the port, *which project* it belongs to, and whether it's safe to stop.

## What I built

`whoport 3000` names the listener, its project (nearest `package.json` or `.git`), its uptime, and the container when Docker published the port, so you don't get `com.docker.backend.exe`.

```
$ whoport 6380
port 6380
container patent-dev-redis-1 (redis:7-alpine), compose patent-dev/redis
Stop it with docker stop patent-dev-redis-1.
```

- `whoport` lists every listening port. `--kill` asks before stopping anything.
- `whoport watch 3000 --until-free && npm start` waits for the port to free up.
- `whoport ui` opens a local dashboard to filter ports and stop them with one click.

Safety: system processes are protected, a process whoport can't identify is never stopped, and containers get `docker stop`, never a kill on the forwarder. The dashboard binds to 127.0.0.1 and rejects foreign `Host` and `Origin` headers.

The CLI and server have zero runtime dependencies. React and Tailwind are build-time only.

```
npm install && npm test && npm run build
node dist/cli.js ui
```

## What I left out

No process-tree killing, no auto-restart, no Electron. I parse `netstat`, `ss` and `lsof` text instead of using native bindings. Project detection is best-effort, since Windows doesn't expose every command line, so unknown shows as `—` and I don't guess. Windows is the only platform I ran for real. The Linux and macOS parsers are tested against hand-written samples.

## What I'd do next

A tray icon or autostart for the dashboard, UDP ports, and real Linux and macOS test runs.