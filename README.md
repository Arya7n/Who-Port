# whoport

Show which process is listening on a TCP port.

```
port 3000

pid       18432
command   node.exe
address   127.0.0.1
protocol  tcp
```

Windows only for now (`netstat -ano` and `tasklist`). Linux and macOS are not implemented yet.

## Run

```
npm install
npm test
npx tsx src/cli.ts 3000
```

Dev dependencies only: `typescript`, `tsx`, and `@types/node` (types for Node built-ins). No runtime dependencies.
