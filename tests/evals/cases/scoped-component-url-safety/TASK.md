# Scoped component URL safety

Fix the package-name validator so a scoped name is accepted only when both its scope and package
component are URL-friendly. Invalid characters in either component must make the name invalid.

Preserve the existing return-object contract, warning behavior, and unscoped-name behavior. Keep
the change bounded to `lib/index.js`; do not add dependencies or use the network.
