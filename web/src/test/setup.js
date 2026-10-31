import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server, resetDb } from './server.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => { server.resetHandlers(); resetDb() })
afterAll(() => server.close())

// jsdom не реализует ResizeObserver (нужен Glide Data Grid)
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
// jsdom не реализует canvas getContext (шумит "Not implemented"); Glide корректно обрабатывает null
HTMLCanvasElement.prototype.getContext = () => null
