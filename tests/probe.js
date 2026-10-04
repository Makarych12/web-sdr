import { KiwiSession } from "../server/kiwi.js";
const url = process.argv[2];
let audio = 0,
  wf = 0;
const s = new KiwiSession(url, (v) => {
  if (Buffer.isBuffer(v)) {
    v[0] === 1 ? audio++ : wf++;
    if (audio > 3 && wf > 2) {
      console.log({ url, audio, wf });
      s.close();
      process.exit(0);
    }
  } else console.log(v);
});
s.start({ frequency: 10000, mode: "AM", zoom: 6 });
setTimeout(() => {
  s.close();
  process.exit(1);
}, 25000);
