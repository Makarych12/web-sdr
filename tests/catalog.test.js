import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCatalog,
  safeReceiverUrl,
  isPublicAddress,
} from "../server/catalog.js";
test("catalog is parsed as data and rejects private/arbitrary targets", () => {
  const rows = parseCatalog(
    'var kiwisdr_com = [{id:"a",name:"Public",url:"http://example.org:8073",status:"active",offline:"no",users:"2",users_max:"4",bands:"0-32000000",},{id:"b",url:"http://127.0.0.1:8787",status:"active",offline:"no"},];',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].maxFrequency, 32000);
  assert.equal(rows[0].users, 2);
  assert.throws(() => parseCatalog("var kiwisdr_com = process.exit();"));
  for (const url of [
    "http://localhost:8073",
    "http://10.0.0.1",
    "http://[::1]",
    "http://192.168.1.1",
    "http://user:password@example.org",
    "http://example.org/internal",
  ])
    assert.equal(safeReceiverUrl(url), null);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
});
