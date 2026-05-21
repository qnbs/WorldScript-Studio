import type { FC } from 'react';
import { useDuckDb } from '../hooks/useDuckDb';

/** Mounts DuckDB worker init when analytics flag is on (pairs with listener migration). */
export const AnalyticsBootstrap: FC = () => {
  useDuckDb();
  return null;
};
