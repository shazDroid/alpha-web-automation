import { EventEmitter } from 'events'
export const bus = new EventEmitter()
export type AgentEvents = 'log' | 'status'
