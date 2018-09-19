"use strict";
var fluid = require("infusion");
var gpii = fluid.registerNamespace("gpii");

var path      = require("path");
var fs        = require("fs");
var minimatch = require("minimatch");

fluid.registerNamespace("gpii.glob");

/**
 *
 * Find all files beneath a root directory based on a list of includes and excludes.  Includes and excludes can be
 * full, package-relative, or "glob" paths, see the README for examples.  All paths are "pathed", i.e. resolved relative
 * to `rootPath`, and then passed to `gpii.glob.scanSingleDir` to begin a recursive scan (see those docs for more
 * details).
 *
 * @param {String} rootPath - A full or package-relative path to search.
 * @param {Array<String>} includes - An array of full or package-relative paths to include in the search results.
 * @param {Array<String>} excludes - An array of full or package-relative paths to exclude from the search results.
 * @param {Object} [minimatchOptions] - (Optional) options to pass to minimatch.
 * @param {Object|Array<String>} [rules] - An optional set of custom rules defining invalid patterns as regular expressions.
 * @return {Array<String>} - An array of full paths to all matching files.
 *
 */
gpii.glob.findFiles = function (rootPath, includes, excludes, minimatchOptions, rules) {
    var invalidIncludes = gpii.glob.validatePatternArray(includes, rules);
    var invalidExcludes = gpii.glob.validatePatternArray(excludes, rules);
    if (invalidIncludes.length || invalidExcludes.length) {
        if (invalidIncludes.length) {
            gpii.glob.logInvalidRuleFeedback(invalidIncludes);
        }
        if (invalidExcludes.length) {
            gpii.glob.logInvalidRuleFeedback(invalidExcludes);
        }

        fluid.fail("One or more glob patterns you have entered are invalid.  Cannot continue.");
    }

    var resolvedPath = gpii.glob.sanitisePath(fluid.module.resolvePath(rootPath));
    var pathedIncludes = gpii.glob.addPathToPatterns(resolvedPath, includes);
    var pathedExcludes = gpii.glob.addPathToPatterns(resolvedPath, excludes);
    return gpii.glob.scanSingleDir(resolvedPath, pathedIncludes, pathedExcludes, minimatchOptions);
};

/**
 * Scan a single directory level and return a list of files and sub-directories that match the includes and do not
 * match the excludes.  Each entry returned must:
 *
 * 1. Match at least one include.
 * 2. Not match a "negated include".
 * 3. Not match an exclude (or be allowed by a "negated exclude").
 *
 * Each file encountered is added to the overall list if all of the above are true.  Directories are handled a bit
 * differently, as we attempt to interpret whether the directory MIGHT contain content that matches an include.  If so,
 * the directory is scanned using this same function, and any sub-matches are added to our results.
 *
 * @param {String} dirPath - A full path to the directory to scan.
 * @param {Array<String>} includes - An array of full or package-relative paths to include in the search results.
 * @param {Array<String>} excludes - An array of full or package-relative paths to exclude from the search results.
 * @param {Object} [minimatchOptions] - (Optional) options to pass to minimatch.
 * @return {Array<String>} An array of matching paths.
 *
 */
gpii.glob.scanSingleDir = function (dirPath, includes, excludes, minimatchOptions) {
    var matchingPaths = [];

    var dirPaths = fs.readdirSync(dirPath).map(function (subPath) { return path.posix.resolve(dirPath, subPath); }).sort();

    // Check to see if this path should be included or excluded
    var allowedPaths = gpii.glob.filterPaths(dirPaths, includes, excludes, minimatchOptions);

    fluid.each(allowedPaths, function (singlePath) {
        var itemStats = fs.statSync(singlePath);
        if (itemStats.isDirectory()) {
            var subMatches = gpii.glob.scanSingleDir(singlePath, includes, excludes, minimatchOptions);
            if (subMatches.length) {
                matchingPaths = matchingPaths.concat(subMatches);
            }
        }
        else if (itemStats.isFile()) {
            matchingPaths.push(singlePath);
        }
    });

    return matchingPaths;
};

/**
 *
 * Filter a list of paths using "includes" and "excludes" and return paths that:
 *
 * 1. Match at least one (non-negated) include.
 * 2. Do not match any negated includes.
 * 3. Either:
 *    a. Do not match any (non-negated) excludes.
 *    b. Match a negated exclude.
 *
 * @param {Array<String>} dirPaths - An array of full paths to check.
 * @param {Array<String>} includes - An array of full or package-relative paths to include in the search results.
 * @param {Array<String>} excludes - An array of full or package-relative paths to exclude from the search results.
 * @param {Object} [minimatchOptions] - (Optional) options to pass to minimatch.
 * @return {Array<String>} An array of paths allowed by the include and exclude filters.
 *
 */
gpii.glob.filterPaths = function (dirPaths, includes, excludes, minimatchOptions) {
    var matchingPaths = [];
    var positiveIncludes = gpii.glob.positivePatterns(includes);
    var negativeIncludes = gpii.glob.negativePatterns(includes);
    var positiveExcludes = gpii.glob.positivePatterns(excludes);
    var negativeExcludes = gpii.glob.negativePatterns(excludes);

    fluid.each(dirPaths, function (singlePath) {
        var stats = fs.statSync(singlePath);
        var isDir = stats.isDirectory();

        var matchesPositiveInclude = fluid.find(positiveIncludes, function (positivePattern) {
            return gpii.glob.matchesSinglePattern(singlePath, positivePattern, minimatchOptions, isDir) || undefined;
        });

        if (matchesPositiveInclude) {
            // Check negated excludes for a match.
            var matchesNegatedExclude = fluid.find(negativeExcludes, function (negatedExcludePattern) {
                return gpii.glob.matchesSinglePattern(singlePath, negatedExcludePattern, minimatchOptions, isDir) || undefined;
            });

            // Negated excludes trump excludes and negated includes.
            if (matchesNegatedExclude) {
                matchingPaths.push(singlePath);
            }
            // Check negated includes and regular excludes together.
            else {
                var combinedExcludes = negativeIncludes.concat(positiveExcludes);
                var matchesExclude = fluid.find(combinedExcludes, function (excludePattern) {
                    // Excludes should not use the special handling for directories.
                    return gpii.glob.matchesSinglePattern(singlePath, excludePattern, minimatchOptions) || undefined;
                });

                if (!matchesExclude) {
                    matchingPaths.push(singlePath);
                }
            }
        }
    });

    return matchingPaths;
};

/**
 *
 * Check a single path against a single "glob" pattern.
 *
 * @param {String} pathToMatch - A full path to evaluate.
 * @param {String} pattern - A single "glob" pattern.
 * @param {Object} [minimatchOptions] - (Optional) options to pass to minimatch.
 * @param {Boolean} [isDir] - (Optional) Whether or not the path refers to a directory.
 * @return {Boolean} `true` if the pattern matches, `false` if not.
 *
 */
gpii.glob.matchesSinglePattern = function (pathToMatch, pattern, minimatchOptions, isDir) {
    minimatchOptions = minimatchOptions || {};

    if (isDir) {
        return gpii.glob.dirMightMatch(pathToMatch, pattern);
    }
    else {
        return minimatch(pathToMatch, pattern, minimatchOptions);
    }
};

/**
 *
 * Match a directory against a pattern and return true if it might contain material that matches the pattern.
 *
 * @param {String} pathToDir - The full path to the directory.
 * @param {String} pattern - The (positive) pattern to test the path against.
 * @return {Boolean} `true` if the directory might contain matches, `false` otherwise.
 *
 */
gpii.glob.dirMightMatch = function (pathToDir, pattern) {
    // We use the equivalent of the basePath option in minimatch, i.e. any directory might contain a pattern with no slashes.
    if (pattern.indexOf("/") !== -1) {
        var patternSegments = pattern.split("/");
        var pathSegments    = pathToDir.split(path.posix.sep);

        for (var a = 0; a < pathSegments.length; a++) {
            var patternSegment = patternSegments[a];

            // If we make it to a directory wildcard, there may be matches in the dir or one of its children.
            if (patternSegment === "**") {
                return true;
            }

            var pathSegment = pathSegments[a];
            if (pathSegment !== patternSegment) {
                return false;
            }
        }
    }

    return true;
};

// The default list of regular expressions that describe "invalid globs".
gpii.glob.invalidGlobRules = {
    noLeadingWildcard: {
        message: "contains a leading wildcard",
        pattern: /^(\.\/)?\*\*/
    },
    noWindowsSeparator: {
        message: "contains a windows separator",
        pattern: /\\/
    },
    noParentDir: {
        message: "contains a reference to a parent directory",
        pattern: /^\.\./
    },
    noRegexp: {
        message: "contains a character used to define a regular expression",
        pattern: /[\[\](){}|]/
    },
    noWholeRoot: {
        message: "contains a reference to the whole of the root directory",
        pattern: /^\.\/$/
    }
};

/**
 *
 * Check a pattern to ensure that it conforms to our constraints, which are:
 *
 * 1. It must not contain a leading wildcard, as in "**" or "./**".
 * 2. It must not contain windows-style separators, i.e. backslashes.
 * 3. It must not begin with a "parent" operator, i.e. "../"
 *
 * @param {String} pattern - A pattern to evaluate.
 * @param {Object|Array<String>} [rules] - An optional set of custom rules defining invalid patterns as regular expressions.
 * @return {Array<Object>} An array of invalid patterns and details about why they are invalid..
 *
 */
gpii.glob.validatePattern = function (pattern, rules) {
    var positivePattern = gpii.glob.positivePattern(pattern);
    rules = rules || gpii.glob.invalidGlobRules;

    var failures = [];
    fluid.each(rules, function (invalidGlobRule) {
        if (positivePattern.match(invalidGlobRule.pattern)) {
            failures.push({
                glob:  positivePattern,
                error: invalidGlobRule.message
            });
        }
    });

    return failures;
};

/**
 *
 * Scan an entire array of patterns using gpii.glob.validatePattern (see above) and combine the results.
 *
 * @param {Array<String>} patternArray - An array of patterns to evaluate.
 * @param {Object|Array<String>} [rules] - An optional set of custom rules defining invalid patterns as regular expressions.
 * @return {Array<Object>} An array of invalid patterns and details about why they are invalid..
 *
 */
gpii.glob.validatePatternArray = function (patternArray, rules) {
    var failures = [];
    fluid.each(patternArray, function (pattern) {
        failures = failures.concat(gpii.glob.validatePattern(pattern, rules));
    });
    return failures;
};

/**
 *
 * Log any invalid rules.
 *
 * @param {Array<Object>} violations - An array of violation objects, which contain a `glob` element (the failing pattern) and an `error` element (detailing why the pattern is invalid).
 */
gpii.glob.logInvalidRuleFeedback = function (violations) {
    fluid.each(violations, function (violation) {
        fluid.log("ERROR: Pattern '" + violation.glob + "' " + violation.error + ".");
    });
};

/**
 *
 * Create a callback function to filter an array for valid/invalid patterns using `gpii.glob.isValidPattern`.
 *
 * @param {Object|Array<String>} [rules] - An optional set of custom rules defining invalid patterns as regular expressions.
 * @param {Boolean} [showInvalid] - Set to true to include only invalid patterns.  By default, valid patterns are returned.
 * @return {Function} A callback function that can be used with `Array.filter()`.
 *
 */
gpii.glob.makePatternFilter = function (rules, showInvalid) {
    return function (pattern) {
        var isValid = gpii.glob.isValidPattern(pattern, rules);
        return showInvalid ? !isValid : isValid;
    };
};

/**
 *
 * Extract the "negative" patterns from an array of patterns, with the leading exclamation points removed.
 *
 * @param {Array<String>} patterns - An array of patterns.
 * @return {Array<String>} All "negative" patterns, with their leading exclamation points removed.
 *
 */
gpii.glob.negativePatterns = function (patterns) {
    return patterns.filter(function (pattern) {
        return pattern.indexOf("!") === 0;
    }).map(function (pattern) {
        return pattern.substring(1);
    });
};

/**
 *
 * Extract the "positive" patterns from an array of patterns.
 *
 * @param {Array<String>} patterns - An array of patterns.
 * @return {Array<String>} Only the "positive" patterns.
 *
 */
gpii.glob.positivePatterns = function (patterns) {
    return patterns.filter(function (pattern) {
        return pattern.indexOf("!") !== 0;
    });
};

/**
 *
 * Return the positive version of a pattern regardless of whether it is already positive or negative.
 *
 * @param {String} pattern - A glob pattern.
 * @return {String} The pattern without any leading negation (!) operator.
 *
 */
gpii.glob.positivePattern = function (pattern) {
    return pattern.indexOf("!") === 0 ? pattern.substring(1) : pattern;
};

/**
 *
 * Add rootPath to relative paths, which are:
 *
 * 1. Paths that start with "./subdir/filename.js".
 * 2. Paths that represent more than one directory level, as "subdir/filename.js"
 *
 * Note that as with minimatch itself, single-level patterns such as "filename.js" are left alone, so that they
 * can be used to represent any file with a given name.
 *
 * @param {String} rootPath - The full path to the root.
 * @param {Array<String>} patterns - One or more patterns to prepend the path to.
 * @return {Array<String>} A copy of the original patterns with the path prepended to each.
 *
 */
gpii.glob.addPathToPatterns = function (rootPath, patterns) {
    // Ensure that the root path does not contain backslashes or a drive letter.
    var sanitisedPath = gpii.glob.sanitisePath(rootPath);

    var pathedPatterns = fluid.transform(patterns, function (pattern) {
        var positivePattern = gpii.glob.positivePattern(pattern);
        var isNegated = positivePattern !== pattern;
        var patternSegments = positivePattern.split("/");
        if (patternSegments.length > 1) {
            var isFullPath = (patternSegments[0] === "");
            var firstSegment = isFullPath ? ("/" + patternSegments[1]) : patternSegments[0];
            var remainingSegments = patternSegments.slice(isFullPath ? 2 : 1);
            // We explicitly resolve paths using the "posix" implementation on all platforms.
            var resolvedPath = path.posix.resolve(sanitisedPath, firstSegment, remainingSegments.join("/"));
            return (isNegated ? "!" : "") + resolvedPath;
        }
        // handle patterns like "file.js"
        else {
            return pattern;
        }
    });
    return pathedPatterns;
};

/**
 *
 * Convert windows-style paths (e.g. `c:\\path\\to\\filename.js`) to glob-compatible patterns,
 * (e.g. `/path/to/filename.js`).
 *
 * @param {String} rawPath - The original path.
 * @return {String} The sanitised path.
 *
 */
gpii.glob.sanitisePath = function (rawPath) {
    // Windows
    if (rawPath.match(/[\:\\]/)) {
        var pathSegments      = rawPath.split(/[\/\\]+/);
        var firstSegment      = pathSegments[0].match(/^[a-zA-Z]:$/) ? "" : pathSegments[0];
        var sanitisedSegments = [firstSegment].concat(pathSegments.slice(1));
        return sanitisedSegments.join("/");
    }
    // Everything else.
    else {
        return rawPath;
    }
};
