import { env } from '@huggingface/transformers';

// QNBS-v3: the product-specific cache key proves ownership; vendor-default buckets can be shared by same-origin apps.
export const WORLD_SCRIPT_TRANSFORMERS_CACHE_NAME = 'worldscript-transformers-cache';
env.cacheKey = WORLD_SCRIPT_TRANSFORMERS_CACHE_NAME;

// QNBS-v3: Proxy module so Vite names the lazy Transformers.js chunk "vendor-transformers".
export * from '@huggingface/transformers';
