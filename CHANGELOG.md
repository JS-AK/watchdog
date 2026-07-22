## [1.2.3](https://github.com/JS-AK/watchdog/compare/v1.2.2...v1.2.3) (2026-07-22)


### Bug Fixes

* align stack capture prebuilds with runtime Node ([f260e30](https://github.com/JS-AK/watchdog/commit/f260e3048e623e185a50e9311db864f4a9f5fb65))

## [1.2.2](https://github.com/JS-AK/watchdog/compare/v1.2.1...v1.2.2) (2026-07-22)


### Bug Fixes

* guard captureStack against Node/V8 ABI mismatch ([0403c2b](https://github.com/JS-AK/watchdog/commit/0403c2baaaff5bbbed7b884b67467f63fc15282e))

## [1.2.1](https://github.com/JS-AK/watchdog/compare/v1.2.0...v1.2.1) (2026-07-22)


### Bug Fixes

* do not emit via N-API from V8 stack interrupt ([bdeeb8d](https://github.com/JS-AK/watchdog/commit/bdeeb8d71a8f84e828b18a72c93f6d168acde346))
* **test:** run node test files serially ([a8c3b43](https://github.com/JS-AK/watchdog/commit/a8c3b43387fe79107150c30c173ec45755805aea))

# [1.2.0](https://github.com/JS-AK/watchdog/compare/v1.1.2...v1.2.0) (2026-07-22)


### Bug Fixes

* build native addon with C++20 for Node 24 V8 ([cd495f9](https://github.com/JS-AK/watchdog/commit/cd495f91585a46564a54f050a312931574d8462b))


### Features

* add opt-in V8 interrupt stack capture ([4303762](https://github.com/JS-AK/watchdog/commit/4303762a8933eda7b61295d035eb7575fdf158a0))
* add opt-in V8 interrupt stack capture ([0437e58](https://github.com/JS-AK/watchdog/commit/0437e58e846bcfa3093fba0a9874306768dc02f6))

## [1.1.2](https://github.com/JS-AK/watchdog/compare/v1.1.1...v1.1.2) (2026-07-22)


### Bug Fixes

* harden native start/stop lifecycle ([7786ef3](https://github.com/JS-AK/watchdog/commit/7786ef3413615fa7cc5e0ff651f8cddf4af62176))

## [1.1.1](https://github.com/JS-AK/watchdog/compare/v1.1.0...v1.1.1) (2026-07-22)


### Bug Fixes

* align v1 contract with implementation ([6b4d429](https://github.com/JS-AK/watchdog/commit/6b4d4297caea35378fd7e82c7be6886cdb1c578d))

# [1.1.0](https://github.com/JS-AK/watchdog/compare/v1.0.0...v1.1.0) (2026-07-22)


### Features

* add native event-loop freeze detector ([fd7cea5](https://github.com/JS-AK/watchdog/commit/fd7cea57ea220217ec71957056942d939b0dde65))

# 1.0.0 (2026-07-22)


### Features

* add JS API stub without native core ([d80dc65](https://github.com/JS-AK/watchdog/commit/d80dc65cb0526d31acde938f0799a3ff622c177a))
