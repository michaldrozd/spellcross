# Sound effects

Drop a sound file here named `<type>.<ext>` and the game uses it instead of the
built-in procedural synthesis. Missing files fall back to synthesis automatically,
so you can add them one at a time. Supported extensions (first match wins):
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

Currently shipped: `gunshot.mp3`, `explosion.mp3` (Mixkit Free License — free for
commercial use, no attribution required). Swap them for anything you prefer.
