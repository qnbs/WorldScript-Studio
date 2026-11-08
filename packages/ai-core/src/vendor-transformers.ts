// QNBS-v3: Set the app-owned cache before pipelines run; the vendor default is shared by same-origin apps.
import { env } from '@huggingface/transformers';

env.cacheKey = 'worldscript-transformers-cache';

export * from '@huggingface/transformers';
