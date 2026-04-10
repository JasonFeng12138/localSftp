import api from './index.js'

export function getUsers() {
  return api.get('/users')
}

export function createUser(data) {
  return api.post('/users', data)
}

export function updateUser(username, data) {
  return api.put(`/users/${username}`, data)
}

export function deleteUser(username) {
  return api.delete(`/users/${username}`)
}
