// Registry of available labs. Add a lab module and list it here.

import { lab01, type Lab } from './lab01/lab'

export type { Lab } from './lab01/lab'

export const LABS: Lab[] = [lab01]

export function labById(id: string): Lab | undefined {
  return LABS.find((l) => l.id === id)
}
