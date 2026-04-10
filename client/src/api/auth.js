import api from './index.js'

export function login(username, password) {
  return api.post('/auth/login', { username, password })
}
