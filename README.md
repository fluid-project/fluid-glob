# gpii-glob

This library provides a means determining a list of relevant files from a given location based on one or more "globbed"
patterns.  Its API consists of a single static function (see below).

## `gpii.glob.findFiles(rootPath, includes, [excludes], [minimatchOptions])`

* `rootPath`: A full or package-relative directory to scan for matching files.
* `includes`: An `Array` of glob patterns that should be included in the results.
* `excludes`: An optional `Array` of glob patterns that should be excluded from the results.
* `minimatchOptions`: An optional `Object` detailing configuration options to be passed to [minimatch](https://github.com/isaacs/minimatch#options).
* Returns: An `Array` of full paths to files that match the supplied glob patterns.

## "glob" Patterns

A "glob" pattern is a string that describes the path to one or more files.  It may contain single-asterisk wildcards
such as `*.js`.  Single asterisks are only matched within a single path segment.  So, for example, `./test/*-node*.js`
matches `./test/all-node-tests.js`, but not `./test/js/another-node-test.js`.

"Glob" patterns may also use double-asterisks to indicate that any number of subdirectories may appear between one part
of a pattern and the next.  So, for example, `./src/**/*.js` matches `./src/index.js` as well as
`./src/js/other.js`.

The underlying concept of a glob is powerful, but can lead to inefficient lookup strategies.  For the sake of
performance, the following are not allowed in patterns used with this library:

1. Patterns starting with `./**`  or `**`, which might require traversing all subdirectories before excludes can be
   applied.
2. Patterns that attempt to break out of the starting directory, i.e. that start with `../`.
3. Patterns that use regular expressions to represent one or more parts of the path.
4. Patterns that use the windows backslash separator in any part of the path.

Patterns can be negated by prepending an exclamation point.  This mechanism allows you to define a more general rule and
then identify one or more exceptions to that rule.   See below for examples.

## Usage Examples

Let's say you have a package called "my-package" whose structure looks roughly as diagrammed in this list:

* (repository root)
  * README.md
  * index.js
  * package.json
  * .gitignore
  * .eslintrc.json
  * src
    * lib
      * forked-deps.js
    * js
      * index.js
  * tests
    * all-tests.js
    * js
      * test1.js
      * test2.js

Let's start by demonstrating includes.  Content can only be brought into scope by a regular (non-negated) include.

```javascript
"use strict";
var fluid = require("infusion");
var gpii  = fluid.registerNamespace("gpii");

require("gpii-glob");

// Let's assume that `fluid.module.resolvePath("%my-package")` resolves to `/source/my-package` for the purposes of
// these examples.
fluid.require("%my-package");

gpii.glob.findFiles("%my-package", [], [], {});
// Returns: An empty array, as there are no includes.

gpii.glob.findFiles("%my-package", ["./src/**/*.js"], [], {});
// Returns: ["/source/my-package/src/js/index.js", "/source/my-package/src/lib/forked-deps.js"]
```

Please note, in order to use the package-relative notation as show above, you must register your package using
[`fluid.module.register`](https://docs.fluidproject.org/infusion/development/NodeAPI.html#fluidmoduleregistername-basedir-modulerequire)
and either `require` or [`fluid.require`](https://docs.fluidproject.org/infusion/development/NodeAPI.html#fluidrequiremodulename-foreignrequire-namespace)
your package.

Negated includes and excludes take precedence over includes, i.e. they remove material from the results:

```javascript
"use strict";
var fluid = require("infusion");
var gpii  = fluid.registerNamespace("gpii");

require("gpii-glob");

// Let's assume that `fluid.module.resolvePath("%my-package")` resolves to `/source/my-package` for the purposes of
// these examples.
fluid.require("%my-package");

gpii.glob.findFiles("%my-package", ["./src/**/*.js", "!./src/lib/**/*.js"], [], {});
// Returns: ["/source/my-package/src/js/index.js"]

// A negated include is basically the same as an exclude.
gpii.glob.findFiles("%my-package", ["./src/**/*.js"], ["./src/lib/**/*.js"], {});
// Also returns: ["/source/my-package/src/js/index.js"]
```

A negated exclude takes precedence over both negated includes and regular excludes.

```javascript
"use strict";
var fluid = require("infusion");
var gpii  = fluid.registerNamespace("gpii");

require("gpii-glob");

// Let's assume that `fluid.module.resolvePath("%my-package")` resolves to `/source/my-package` for the purposes of
// these examples.
fluid.require("%my-package");

// A negated exclude takes precedence over both negated includes and regular excludes.
gpii.glob.findFiles("%my-package", ["./tests/**/*.js"], ["./tests/js/**/*.js", "!./tests/js/test1.js"], {});
// Returns: [
//  "/source/my-package/tests/all-tests.js",
//  "/source/my-package/tests/js/test1.js",
// ]
```

The file `test1.js` is brought back into the list of matching files by the negated exclude, `test2.js` remains excluded.

By default, filename wildcards (such as `*.json`) do not explicitly match "dot files".  By passing the relevant option
to the underlying "minimatch" library, you can change this behaviour as shown here.

```javascript
"use strict";
var fluid = require("infusion");
var gpii  = fluid.registerNamespace("gpii");

require("gpii-glob");

// Let's assume that `fluid.module.resolvePath("%my-package")` resolves to `/source/my-package` for the purposes of
// these examples.
fluid.require("%my-package");

// A filename wildcard search with the default minimatch options.
gpii.glob.findFiles("%my-package", ["./*.json"], [], {});
// Returns: ["/source/my-package/package.json"]

// A filename wildcard search with custom minimatch options.
gpii.glob.findFiles("%my-package", ["./*.json"], [], { dot: true });
// Returns: ["/source/my-package/.eslintrc.json", "/source/my-package/package.json"]
```

For a full list of minimatch options, see [their documentation](https://github.com/isaacs/minimatch#options).  Please
note, minimatch options only control which files match. This package uses its own means of evaluating whether a
directory *might* contain matching content, and minimatch options will not affect this.
