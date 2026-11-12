// QNBS-v3: Set the app-owned cache before pipelines run; the vendor default is shared by same-origin apps.
import { env } from '@huggingface/transformers';
import { dropRemoteWasmPaths } from './onnxWasmPaths';

env.cacheKey = 'worldscript-transformers-cache';
// QNBS-v3 (#556): load ONNX Runtime's WASM same-origin, not from the CDN that transformers sets and the CSP blocks.
dropRemoteWasmPaths(env.backends?.onnx?.wasm);

export * from '@huggingface/transformers';
