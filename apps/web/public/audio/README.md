# Optional sound effects

The default game uses built-in procedural synthesis and ships no third-party sound
effect binaries. A distributor can supply licensed replacements named `<type>.<ext>`;
missing files continue to use synthesis automatically. Supported extensions (first match wins):
`webm`, `mp3`, `ogg`, `wav`.

Recognised types (see `apps/web/src/services/AudioManager.ts`):

| file | when it plays |
|------|---------------|
| `gunshot`   | small-arms / autocannon / generic weapon fire (covers most attacks) |
| `explosion` | vehicle / artillery / rocket / shell impacts |
| `hit`       | a unit takes damage |
| `death`     | a unit is destroyed |
| `magic`     | spell / fantasy weapon |
| `select`    | unit selected |
| `move`      | move order issued |
| `tankMove`  | vehicle moves |
| `infantry`  | infantry moves |
| `turnStart` | new turn |
| `error`     | invalid action |
| `victory`   | battle won |
| `defeat`    | battle lost |
