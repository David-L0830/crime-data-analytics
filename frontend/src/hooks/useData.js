import { useContext } from 'react';
import { DataContext } from '../context/DataContext';

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
