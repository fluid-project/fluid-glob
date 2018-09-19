/* eslint-env node */
"use strict";
var fluid = require("infusion");
fluid.module.register("gpii-glob", __dirname, require);

require("./src/js/glob.js");
