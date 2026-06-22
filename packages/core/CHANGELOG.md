# Changelog

## [0.8.0](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.7.0...superdense-core-v0.8.0) (2026-06-22)


### Features

* add batch reward recording, human-only threads, and DB migration guard ([#77](https://github.com/Nimrobo/superdense/issues/77)) ([eaa1bc8](https://github.com/Nimrobo/superdense/commit/eaa1bc8fe9375f56f2512c6eecf07a3cdba3fdf1))
* add outcome hypotheses and experiments ([#78](https://github.com/Nimrobo/superdense/issues/78)) ([04e2940](https://github.com/Nimrobo/superdense/commit/04e2940b3ad43b8a3cff755159fb2833bf072bb4))
* reward collection lifecycle, reward next/retire commands, settled thread curation ([#80](https://github.com/Nimrobo/superdense/issues/80)) ([d940139](https://github.com/Nimrobo/superdense/commit/d940139912c955ff230d525d8dde7d745fc052f3))
* reward pipeline UI with hypothesis and experiment tracking ([#81](https://github.com/Nimrobo/superdense/issues/81)) ([31b79aa](https://github.com/Nimrobo/superdense/commit/31b79aac082c69ed174d74b84df5486817421c49))

## [0.7.0](https://github.com/Nimrobo/superdense/compare/superdense-core-v0.6.1...superdense-core-v0.7.0) (2026-06-19)


### Features

* add batch reward recording, human-only threads, and DB migration guard ([#77](https://github.com/Nimrobo/superdense/issues/77)) ([eaa1bc8](https://github.com/Nimrobo/superdense/commit/eaa1bc8fe9375f56f2512c6eecf07a3cdba3fdf1))
* add Cursor session adapter ([#38](https://github.com/Nimrobo/superdense/issues/38)) ([dccc518](https://github.com/Nimrobo/superdense/commit/dccc518ca4d415a1c84eadc705cc0b81f8857464))
* add outcome hypotheses and experiments ([#78](https://github.com/Nimrobo/superdense/issues/78)) ([04e2940](https://github.com/Nimrobo/superdense/commit/04e2940b3ad43b8a3cff755159fb2833bf072bb4))
* add query run history ([#49](https://github.com/Nimrobo/superdense/issues/49)) ([d59df44](https://github.com/Nimrobo/superdense/commit/d59df44f0d0dcfad8ee654792b1525d59a8a58f4))
* add reward layer for Superdense — curation, artifacts, cohorts, projects, enrichers, and reward UI ([#58](https://github.com/Nimrobo/superdense/issues/58)) ([2c0533d](https://github.com/Nimrobo/superdense/commit/2c0533dff4ba7a29d4c46103088d77de4e8bf142))
* add session costing via adapter enrichers ([#62](https://github.com/Nimrobo/superdense/issues/62)) ([3731ab4](https://github.com/Nimrobo/superdense/commit/3731ab455ffabea7ebae7f6406681deb2e18cbdd))
* add session search filter context and improve UI ([#36](https://github.com/Nimrobo/superdense/issues/36)) ([62f7e2e](https://github.com/Nimrobo/superdense/commit/62f7e2edbbf9ddd7f7dcddc3c0c9cf5e6cd64c9c))
* index and query sub-agent sessions ([#51](https://github.com/Nimrobo/superdense/issues/51)) ([2d786d7](https://github.com/Nimrobo/superdense/commit/2d786d7f8bd9241ff2ea7f1c88b0cc6db9431399))
* surface contributor run costs in cohort members ([#67](https://github.com/Nimrobo/superdense/issues/67)) ([d960a9e](https://github.com/Nimrobo/superdense/commit/d960a9eb24ee4fde6ed4a2403b5e83d4d341cc5b))


### Bug Fixes

* exclude sub-agent sessions from dashboard stats ([#54](https://github.com/Nimrobo/superdense/issues/54)) ([4a753f4](https://github.com/Nimrobo/superdense/commit/4a753f479253c24de7941b0999fc4ccbd0419c80))
* ignore missing Claude transcripts ([#72](https://github.com/Nimrobo/superdense/issues/72)) ([ac9f722](https://github.com/Nimrobo/superdense/commit/ac9f722e5e68bb77da33c663beff5cc81cd7ba81))
* improve session query search behavior ([#55](https://github.com/Nimrobo/superdense/issues/55)) ([de2e07d](https://github.com/Nimrobo/superdense/commit/de2e07de011ef252b30dc80855de41fe5ecc1f3b))
* trigger release for npm provenance URL fix ([f0ce6c9](https://github.com/Nimrobo/superdense/commit/f0ce6c9b051f7da01b9d2b91902e34af308b58e3))

## [0.6.1](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.6.0...superdense-core-v0.6.1) (2026-06-13)


### Bug Fixes

* ignore missing Claude transcripts ([#72](https://github.com/Nimrobo/superdense/issues/72)) ([ac9f722](https://github.com/Nimrobo/superdense/commit/ac9f722e5e68bb77da33c663beff5cc81cd7ba81))

## [0.6.0](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.5.0...superdense-core-v0.6.0) (2026-06-08)


### Features

* surface contributor run costs in cohort members ([#67](https://github.com/Nimrobo/superdense/issues/67)) ([d960a9e](https://github.com/Nimrobo/superdense/commit/d960a9eb24ee4fde6ed4a2403b5e83d4d341cc5b))

## [0.5.0](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.4.0...superdense-core-v0.5.0) (2026-06-06)


### Features

* add session costing via adapter enrichers ([#62](https://github.com/Nimrobo/superdense/issues/62)) ([3731ab4](https://github.com/Nimrobo/superdense/commit/3731ab455ffabea7ebae7f6406681deb2e18cbdd))

## [0.4.0](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.3.1...superdense-core-v0.4.0) (2026-06-04)


### Features

* add reward layer for Superdense — curation, artifacts, cohorts, projects, enrichers, and reward UI ([#58](https://github.com/Nimrobo/superdense/issues/58)) ([2c0533d](https://github.com/Nimrobo/superdense/commit/2c0533dff4ba7a29d4c46103088d77de4e8bf142))

## [0.3.1](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.3.0...superdense-core-v0.3.1) (2026-05-29)


### Bug Fixes

* exclude sub-agent sessions from dashboard stats ([#54](https://github.com/Nimrobo/superdense/issues/54)) ([4a753f4](https://github.com/Nimrobo/superdense/commit/4a753f479253c24de7941b0999fc4ccbd0419c80))
* improve session query search behavior ([#55](https://github.com/Nimrobo/superdense/issues/55)) ([de2e07d](https://github.com/Nimrobo/superdense/commit/de2e07de011ef252b30dc80855de41fe5ecc1f3b))

## [0.3.0](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.2.1...superdense-core-v0.3.0) (2026-05-28)


### Features

* add query run history ([#49](https://github.com/Nimrobo/superdense/issues/49)) ([d59df44](https://github.com/Nimrobo/superdense/commit/d59df44f0d0dcfad8ee654792b1525d59a8a58f4))
* index and query sub-agent sessions ([#51](https://github.com/Nimrobo/superdense/issues/51)) ([2d786d7](https://github.com/Nimrobo/superdense/commit/2d786d7f8bd9241ff2ea7f1c88b0cc6db9431399))

## [0.2.1](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.2.0...superdense-core-v0.2.1) (2026-05-26)


### Bug Fixes

* trigger release for npm provenance URL fix ([f0ce6c9](https://github.com/Nimrobo/superdense/commit/f0ce6c9b051f7da01b9d2b91902e34af308b58e3))

## [0.2.0](https://github.com/Nimrobo/superdense/compare/@nimrobo/superdense-v0.1.1...superdense-core-v0.2.0) (2026-05-26)


### Features

* add Cursor session adapter ([#38](https://github.com/Nimrobo/superdense/issues/38)) ([dccc518](https://github.com/Nimrobo/superdense/commit/dccc518ca4d415a1c84eadc705cc0b81f8857464))
* add session search filter context and improve UI ([#36](https://github.com/Nimrobo/superdense/issues/36)) ([62f7e2e](https://github.com/Nimrobo/superdense/commit/62f7e2edbbf9ddd7f7dcddc3c0c9cf5e6cd64c9c))
