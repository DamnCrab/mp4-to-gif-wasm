declare module "*.wasm" {
  const value: WebAssembly.Module;
  export default value;
}

declare module "*.wasm?url" {
  const value: string;
  export default value;
}
