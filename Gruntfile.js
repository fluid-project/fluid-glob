/* eslint-env node */
"use strict";
var fluid = require("infusion");
var gpii  = fluid.registerNamespace("gpii");
require("./");

module.exports = function (grunt) {
    var globbedSources = {
        md: ["./*.md"],
        js: ["./*.js", "./src/**/*.js", "./tests/**/*.js", "./tests/*.js", "./*.js"],
        json: ["./*.json", "!./package-lock.json"],
        json5: [],
        other: ["./.*"]
    };

    // We manually resolve our globs to raw paths to ensure that our code is used rather than
    // the copy of ourselves we inherit from gpii-grunt-lint-all.  In regular usage, you should
    // simply pass the globs themselves.
    var fullPathSources = fluid.transform(globbedSources, function (globbedPaths) {
        return gpii.glob.findFiles("%gpii-glob", globbedPaths, [], {dot: true});
    });

    grunt.initConfig({
        lintAll: {
            sources: fullPathSources,
            expandPaths: false // This package is really the only one that should use this option.
        }
    });

    grunt.loadNpmTasks("gpii-grunt-lint-all");
    grunt.registerTask("lint", "Perform all standard lint checks.", ["lint-all"]);
};
