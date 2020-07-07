/* eslint-env node */
"use strict";
var fluid = require("infusion");
fluid.module.register("fluid-glob", __dirname, require);

require("./src/js/glob.js");
