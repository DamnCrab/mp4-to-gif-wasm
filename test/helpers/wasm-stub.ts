const wasmBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00
]);

const wasmStub = new WebAssembly.Module(wasmBytes);

export default wasmStub;
