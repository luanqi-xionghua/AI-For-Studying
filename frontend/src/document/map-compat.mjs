const install = (prototype, name, implementation) => {
  if (typeof prototype[name] === 'function') return
  Object.defineProperty(prototype, name, {
    configurable: true,
    writable: true,
    value: implementation,
  })
}

const mapHas = Map.prototype.has
const mapGet = Map.prototype.get
const mapSet = Map.prototype.set

install(Map.prototype, 'getOrInsertComputed', function (key, callback) {
  if (typeof callback !== 'function') throw new TypeError('callback must be callable')
  if (mapHas.call(this, key)) return mapGet.call(this, key)
  const value = callback(key)
  mapSet.call(this, key, value)
  return value
})

install(Map.prototype, 'getOrInsert', function (key, value) {
  if (mapHas.call(this, key)) return mapGet.call(this, key)
  mapSet.call(this, key, value)
  return value
})

const weakMapHas = WeakMap.prototype.has
const weakMapGet = WeakMap.prototype.get
const weakMapSet = WeakMap.prototype.set

install(WeakMap.prototype, 'getOrInsertComputed', function (key, callback) {
  weakMapHas.call(this, {})
  if ((typeof key !== 'object' || key === null) && typeof key !== 'function') {
    throw new TypeError('WeakMap key must be an object')
  }
  if (typeof callback !== 'function') throw new TypeError('callback must be callable')
  if (weakMapHas.call(this, key)) return weakMapGet.call(this, key)
  const value = callback(key)
  weakMapSet.call(this, key, value)
  return value
})

install(WeakMap.prototype, 'getOrInsert', function (key, value) {
  weakMapHas.call(this, {})
  if ((typeof key !== 'object' || key === null) && typeof key !== 'function') {
    throw new TypeError('WeakMap key must be an object')
  }
  if (weakMapHas.call(this, key)) return weakMapGet.call(this, key)
  weakMapSet.call(this, key, value)
  return value
})
