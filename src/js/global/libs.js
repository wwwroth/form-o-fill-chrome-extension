/*global Logger Rules lastActiveTab FormFiller Utils */
/*eslint no-loop-func:0 */
// This creates a "safe" namespace for all libs
var Libs = {
  _libs: {},
  add: function(libraryName, librayTopLevelFunction, forceAdd) {
    // Check if the method is already defined
    forceAdd = forceAdd || false;
    if((this._libs[libraryName] || this.hasOwnProperty(libraryName)) && !forceAdd) {
      Logger.info("[libs.js] Can not add library named '" + libraryName + "' because it already exists as a function().");
      return;
    }
    this[libraryName] = librayTopLevelFunction;
    Logger.info("[libs.js] Added library as Libs." + libraryName);
  },
  import: function() {
    return new Promise(function (resolve) {
      Rules.all().then(function (rules) {
        rules.forEach(function (rule) {
          if (typeof rule.export !== "undefined" && typeof rule.lib === "function") {
            // Add the rule into the scope of all library functions
            Libs.add(rule.export, rule.lib, true);
          }
        });
      }).then(resolve("libraries imported"));
    });
  },
  // Dectects libraries used in a rulecode string
  // returns an array of found libraries
  detectLibraries: function(ruleCodeString) {
    var detectedLibs = [];
    Object.keys(Utils.vendoredLibs).forEach(function dtctLib(vLibKey) {
      if(ruleCodeString.match(Utils.vendoredLibs[vLibKey].detectWith) !== null) {
        // Found!
        detectedLibs.push(vLibKey);
      }
    });
    return detectedLibs;
  },
  loadLibs: function(scriptPaths, whoCallsMe) {
    /*eslint-disable complexity */
    return new Promise(function (resolve) {
      if(typeof scriptPaths === "string") {
        scriptPaths = [scriptPaths];
      }

      // If there is no script to inject
      // OR we run in the context of the content page
      // resolve now
      // The content page gets its libraries by using the chrome API (see background/form_util.js#injectAndAttachToLibs)
      if(scriptPaths.length === 0 || !Utils.isBgPage()) {
        resolve(0);
        return;
      }

      var anchor = document.querySelector("body");
      var fragment = document.createDocumentFragment();

      var loadedScriptCount = 0;
      var targetScriptCount = scriptPaths.length;
      var scriptPath;

      for(var i = 0; i < targetScriptCount; i++) {
        scriptPath = scriptPaths[i];

        var vLib = Utils.vendoredLibs[scriptPath];
        var libName = vLib.name;

        // If a lib with that name is already present, don't load it again
        if(typeof Libs[libName] !== "undefined") {
          loadedScriptCount++;
          Logger.info("[libs.js] Didn't load '" + scriptPath + "' again");
          continue;
        }

        // If the requested lbrary is not vendored, break loop
        if(typeof vLib === "undefined") {
          Logger.info("[libs.js] Didn't load '" + scriptPath + "' since it is not vendored (see utils.js)");
          loadedScriptCount++;
          continue;
        }

        // If the library is present on window (somehow) just add it to Libs (again)
        if(typeof window[vLib.onWindowName] !== "undefined" && typeof Libs[libName] === "undefined") {
          Libs.add(libName, window[vLib.onWindowName]);
          loadedScriptCount++;
          continue;
        }

        var script = document.createElement("script");
        script.async = false;
        script.dataset.who = whoCallsMe;
        script.className = "injectedByFormOFill";
        script.dataset.script = scriptPath;
        script.src = chrome.extension.getURL(scriptPath);
        script.onload = function() {
          // Add Library to Libs
          Libs.add(libName, window[vLib.onWindowName]);
          loadedScriptCount++;
          Logger.info("[libs.js] Loaded '" + scriptPath + "'");

          // If all script are loaded, resolve promise
          if (loadedScriptCount >= targetScriptCount) {
            resolve(loadedScriptCount);
          }
        };
        script.onerror = function() {
          resolve(loadedScriptCount);
        };

        // Since this is all async make sure nobody has already
        // inserted it while we worked on this script:
        if(document.querySelectorAll("script[data-script='" + scriptPath + "']").length === 0) {
          fragment.appendChild(script);
        }
      }

      // If the loop is ready and the count already matches,
      // there was nothing to to and that's ok
      if (loadedScriptCount >= targetScriptCount) {
        resolve(loadedScriptCount);
      }

      // Only insert the fragment if it has something inside
      if(fragment.childNodes.length > 0) {
        anchor.appendChild(fragment);
      }
    });
    /*eslint-enable complexity */
  }
};

// Change the text of the throbber
var setThrobberText = function(text) {
  if(lastActiveTab === null) {
    return null;
  }

  // Since this is called from the background pages
  // we need to send a message to the content.js
  chrome.tabs.sendMessage(lastActiveTab.id, {action: "showOverlay", message: text});
};
Libs.add("displayMessage", setThrobberText);

// helper for use in value functions
//
// "value" : Libs.h.click  => Clicks on the element specified by 'selector'
var valueFunctionHelper = {
  click: function($domNode) {
    $domNode.click();
  },
  screenshot: function(saveAs) {
    chrome.runtime.sendMessage({action: "takeScreenshot", value: FormFiller.currentRuleMetadata, flag: saveAs});
  },
  copyValue: function(selector) {
    if(!Utils.isBgPage()) {
      var $source = document.querySelector(selector);
      if($source === null) {
        // element not found
        setThrobberText("Libs.h.copyValue didn't find source element with selector '" + selector + "'.");
        return null;
      }

      // element found
      return $source.value;
    }
  }
};
Libs.add("h", valueFunctionHelper);


// Process control functions
var processFunctionsHalt = function(msg) {
  return function() {
    if(typeof lastActiveTab === "undefined") {
      return null;
    }

    if(typeof msg === "undefined") {
      msg = "Canceled by call to Libs.halt()";
    }

    setThrobberText(msg);
    return null;
  };
};
Libs.add("halt", processFunctionsHalt);


// Import all saved libs
Libs.import();
