MobileSAM ONNX export (image encoder + single-mask decoder), from https://huggingface.co/Acly/MobileSAM (license: MIT).
Original model: MobileSAM, https://github.com/ChaoningZhang/MobileSAM (Apache-2.0), distilled from Meta's Segment Anything (Apache-2.0).
Runtime: onnxruntime-web 1.30.0 (MIT), WASM backend, files in ../ort/.

ort/ort-wasm-simd-threaded.mjs is patched: the shared WebAssembly.Memory maximum is 8192 pages (512 MB, override globalThis.__gfWasmMaxPages) instead of 65536 (4 GB), because iOS Safari fails with "RangeError: Out of memory" when asked to reserve a 4 GB shared memory.
