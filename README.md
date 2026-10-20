# whoport

## What annoyed me

I start a Nest service and get `EADDRINUSE: port 3000`. Then I copy a PID out of `lsof` or `netstat` and try to decide whether it is a stale `ts-node` from another repo or something I still need. `kill-port` just kills it.

## What I built

`whoport` names the listener, the project (nearest `package.json` or `.git`), how long it has been up, and the container when Docker published the port. `whoport 3000 --kill` asks before stopping anything. `whoport` with no arguments lists every listening TCP port and lets me pick a row.

```
port 6380
address   0.0.0.0, 127.0.0.1, ::, ::1
container patent-dev-redis-1
image     redis:7-alpine
compose   patent-dev/redis

Docker container patent-dev-redis-1 (redis:7-alpine), compose patent-dev/redis. Stop it with docker stop patent-dev-redis-1.
```

```
npm install && npm test && npm run build
node dist/cli.js 6380
```

## What I left out

I parse `netstat`, `ss`, and `lsof` text instead of shipping native bindings. I do not kill child processes, restart what I stopped, or wrap this in Electron. Linux and macOS parsers are included, but this machine is Windows; the `ss` sample is hand-written because WSL has no `ss`.

## What I'd do next

`whoport watch 3000`, so the terminal tells me when the port frees. A localhost page only if I still want a table I can click.
