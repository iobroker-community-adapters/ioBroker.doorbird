/**
 *
 * doorbird adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "doorbird",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.0",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Node.js doorbird Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "name <mail@doorbird.com>"
 *          ]
 *          "desc":         "doorbird adapter",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "materialize":  true,                       // support of admin3
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42,
 *          "mySelect": "auto"
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';


var utils = require(__dirname + '/lib/utils');
var birdConCheck;
var adapter = new utils.Adapter('doorbird');
var dgram = require('dgram');
var udpserver = dgram.createSocket('udp4');
var _sodium = require('libsodium-wrappers');
var request = require('request');
var fs = require('fs');
var http = require('http');
var path = require('path');
var ringActive = false;
var wizard = false;
var wizardTimeout = false;
var authorized = false;
var jpgpath = path.normalize(path.join(utils.controllerDir, require(path.join(utils.controllerDir, 'lib', 'tools.js')).getDefaultDataDir()) + '/' + adapter.namespace + '.snap.jpg');
var download = function (url, filename, callback) {
    request.head(url, function (err, res, body) {
        request(url).pipe(fs.createWriteStream(filename)).on('close', callback);
    });
};

adapter.on('unload', function (callback) {
    try {
        clearInterval(birdConCheck);
        http.close();
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    // adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
});

adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    // adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
    // if (state && !state.ack) {
    //     adapter.log.debug('ack is not set!');
    // }
});

adapter.on('message', function (msg) {
    if (msg.command === 'wizard' && !wizard) {
        startWizard(msg);
        wizard = true;
    }
});

adapter.on('ready', function () {
    adapter.setState('info.connection', false, true);
    main();
});

function buildURL(com) {
    return 'http://' + adapter.config.birdip + '/bha-api/' + com + '.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw;
}

function testBird() {
    request(buildURL('schedule'), function (error, response, body) {
        if (!error) {
            //  adapter.log.debug('testBird() ResponseCode: ' + response.statusCode);
            if (response.statusCode === 401) {
                authorized = false;
                adapter.setState('info.connection', false, true);
                adapter.log.error('Whooops.. DoorBird says User ' + adapter.config.birduser + ' is unauthorized!!');
                adapter.log.error('Check Username + Password and enable the "API-Operator" Permission for the User!!');
            } else if (response.statusCode === 200) {
                authorized = true;
                adapter.setState('info.connection', true, true);
                adapter.log.debug('Authorization with User ' + adapter.config.birduser + ' successfull!');
                getInfo();
                checkFavorites();
            }
        } else {
            if (error.code === "EHOSTUNREACH") {
                authorized = false;
                adapter.setState('info.connection', false, true);
                adapter.log.error('DoorBird Device is offline!!');
            } else {
                authorized = false;
                adapter.log.error('Error in testBird() Request: ' + error);
                adapter.setState('info.connection', false, true);
            }
        }
    });
}

function getInfo() {
    if (authorized) {
        request(buildURL('info'), function (error, response, body) {
            if (!error) {
                try {
                    if (response.statusCode === 200) {
                        var info = JSON.parse(body);
                        adapter.setState('info.firmware', info.BHA.VERSION[0].FIRMWARE, true);
                        adapter.setState('info.build', info.BHA.VERSION[0].BUILD_NUMBER, true);
                        //  adapter.setState('info.wifimac', info.BHA.VERSION[0].WIFI_MAC_ADDR, true);
                        adapter.setState('info.type', info.BHA.VERSION[0]['DEVICE-TYPE'], true);
                    }
                }
                catch (e) {
                    adapter.log.error('Error in Parsing getInfo(): ' + e);
                }
            } else {
                adapter.log.error('Error in getInfo(): ' + error);
            }
        });
    } else {
        adapter.log.error('Execution of getInfo not allowed because not authorized!');
    }
}

function startWizard(msg) {
    wizard = true;
    var wizData = [];
    var wizServer = dgram.createSocket('udp4');
    wizServer.on('listening', function () {
        var address = wizServer.address();
        adapter.log.debug('Wizard listening on IP: ' + address.address + ' - UDP Port 6524');
    });

    wizServer.on('message', function (message, remote) {
        if (remote.address && message.length > 25 && wizData.length == 0) {
            wizData.push(remote.address);
        }
        if (wizData[0] == remote.address && message.length < 25) {
            wizData.push(message.toString('utf-8').split(':')[1]);
            adapter.sendTo(msg.from, msg.command, wizData, msg.callback);
            wizard = false;
            clearTimeout(wizardTimeout);
            wizServer.close();
        }
    });

    wizServer.bind(6524);
    wizardTimeout = setTimeout(function () {
        wizServer.close();
        wizard = false;
        adapter.log.debug('Wizard timeout!');
    }, 60000);

}

function checkSchedules() {
    if (authorized) {
        request(buildURL('schedule'), function (error, response, body) {
            if (!error) {
                try {
                    if (response.statusCode === 200) {
                        var schedules = JSON.parse(body);
                        adapter.log.debug(JSON.stringify(body));
                        for (var key in schedules) {
                            if (!schedules.hasOwnProperty(key)) continue;
                            var obj = schedules[key];
                            for (var prop in obj) {
                                if (!obj.hasOwnProperty(prop)) continue;
                                adapter.log.debug('Detected HTTP Favorite (ID: ' + key + ') (' + prop + " = " + obj[prop] + ')');
                            }
                        }
                    }
                }
                catch (e) {
                    adapter.log.error('Error in Parsing Schedules: ' + e);
                }
            } else {
                adapter.log.error('Error in checkSchedules(): ' + error);
            }
        });
    } else {
        adapter.log.error('Execution of checkSchedules not allowed because not authorized!');
    }
}


function checkFavorites() {
    if (authorized) {
        request(buildURL('favorites'), function (error, response, body) {
            if (!error) {
                try {
                    if (response.statusCode === 200) {
                        var birdRingFav = false;
                        var birdMotionFav = false;
                        var favorites = JSON.parse(body);
                        for (var key in favorites.http) {
                            if (!favorites.http.hasOwnProperty(key)) continue;
                            var obj = favorites.http[key];
                            for (var prop in obj) {
                                if (!obj.hasOwnProperty(prop)) continue;
                                // adapter.log.debug('Detected HTTP Favorite (ID: ' + key + ') (' + prop + " = " + obj[prop] + ')');
                                if (obj[prop] == 'ioBroker ' + adapter.namespace + ' Ring') {
                                    birdRingFav = true;
                                    adapter.config.ringFavID = key;
                                }
                                if (obj[prop] == 'ioBroker ' + adapter.namespace + ' Motion') {
                                    birdMotionFav = true;
                                    adapter.config.motionFavID = key;
                                }
                            }
                        }
                        if (!birdRingFav) {
                            try {
                                adapter.log.debug('Adding Ring-HTTP-Favorite on Doorbird-Device..');
                                request('http://' + adapter.config.birdip + '/bha-api/favorites.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw + '&action=save&type=http&title=ioBroker ' + adapter.namespace + ' Ring&value=http://' + adapter.config.adapterAddress + ':' + adapter.config.adapterport + '/ring');
                            } catch (error) {
                                adapter.log.error('Error in setting Ring-Favorite: ' + error);
                            }
                        } else {
                            adapter.log.debug('Ring-HTTP-Favorite detected successfully.');
                        }
                        if (!birdMotionFav) {
                            try {
                                adapter.log.debug('Adding Motion-HTTP-Favorite on Doorbird-Device..');
                                request('http://' + adapter.config.birdip + '/bha-api/favorites.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw + '&action=save&type=http&title=ioBroker ' + adapter.namespace + ' Motion&value=http://' + adapter.config.adapterAddress + ':' + adapter.config.adapterport + '/motion');
                            } catch (error) {
                                adapter.log.error('Error in setting Motion-Favorite: ' + error);
                            }
                        } else {
                            adapter.log.debug('Motion-HTTP-Favorite detected successfully.');
                        }
                        checkSchedules();
                    }
                }
                catch (e) {
                    adapter.log.error('Error in Parsing favorites: ' + e);
                }
            } else {
                adapter.log.error('Error in getFavorites(): ' + error);
            }
        });
    } else {
        adapter.log.error('Execution of getFavorites() not allowed because not authorized!');
    }
}

function sendToState(cmd) {
    let fileData;
    try {
        fileData = fs.readFileSync(jpgpath);
        adapter.setBinaryState(adapter.namespace + '.' + cmd + '.snapshot', fileData, function () {
            adapter.log.debug('Snapshot sent to State!');
        });
    } catch (e) {
        adapter.log.error('Cannot upload JPG to State: ' + e);
        return;
    }
}

function main() {
    if (adapter.config.birdip && adapter.config.birdpw && adapter.config.birduser) {
        testBird();
        birdConCheck = setInterval(testBird, 180000);
    }

    udpserver.on('listening', function () {
        var address = udpserver.address();
        adapter.log.debug('Adapter listening on IP: ' + address.address + ' - UDP Port 35344');
    });

    udpserver.on('message', function (msg, remote) {
        if (remote.address == adapter.config.birdip && !wizard) {
            decryptDoorBird(msg);
        }
    });

    // udpserver.bind(35344);

    http.createServer(function (req, res) {
        if (res.socket.remoteAddress.replace(/^.*:/, '') == adapter.config.birdip) {
            res.writeHead(204, { 'Content-Type': 'text/plain' });
            if (req.url == '/motion') {
                adapter.log.debug('Received Motion-alert from Doorbird!');
                adapter.setState('motion.trigger', true, true);
                download(buildURL('image'), jpgpath, function () {
                    adapter.log.debug('Image downloaded!');
                    sendToState('motion');
                });
                setTimeout(function () {
                    adapter.setState('motion.trigger', false, true)
                }, 2500);
            }
            if (req.url == '/ring') {
                adapter.log.debug('Received Ring-alert from Doorbird!');
                adapter.setState('ring.trigger', true, true);
                download(buildURL('image'), jpgpath, function () {
                    adapter.log.debug('Image downloaded!');
                    sendToState('ring');
                });
                setTimeout(function () {
                    adapter.setState('ring.trigger', false, true)
                }, 2500);
            }
            res.end();
        } else {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end();
        }
    }).listen(adapter.config.adapterport || 8100, adapter.config.adapterAddress || '0.0.0.0');

    adapter.subscribeStates('*');
}

function decryptDoorBird(message) {
    if (message.length > 25) {
        if (!ringActive) {
            ringActive = true;
            (async () => {
                const IDENT = message.slice(0, 3);
                const VERSION = message.slice(3, 4);
                const OPSLIMIT = message.slice(4, 8);
                const MEMLIMIT = message.slice(8, 12);
                const SALT = message.slice(12, 28);
                const NONCE = message.slice(28, 36);
                const CIPHERTEXT = message.slice(36);
                const PASSWORD = adapter.config.birdpw;

                await _sodium.ready;
                const sodium = _sodium;

                function stretch(password, salt) {
                    let hash = sodium.crypto_pwhash(32, password.substr(0, 5), salt, 4, 8192, sodium.crypto_pwhash_ALG_ARGON2I13);
                    return Buffer.from(hash);
                };

                function decrypt(ciphertext, nonce, key) {
                    try {
                        let dec = sodium.crypto_aead_chacha20poly1305_decrypt(null, ciphertext, null, nonce, key);
                        return Buffer.from(dec);
                    } catch (error) {
                        return null;
                    }
                };

                let key = await stretch(PASSWORD, SALT);
                let dec = await decrypt(CIPHERTEXT, NONCE, key);

                if (dec) {
                    const birdid = dec.slice(0, 6).toString('utf-8');
                    const birdevent = dec.slice(6, 14).toString('utf-8');
                    const birdstamp = dec.slice(14).readInt32BE(0);
                    adapter.log.debug('Bird Message: ' + birdid + ' ' + birdevent + ' ' + birdstamp);
                    if (birdevent.startsWith('1')) {
                        adapter.log.debug('Ring received! (ID: ' + birdid + ')');
                        adapter.setState('ring.trigger', true, true);
                        setTimeout(function () {
                            adapter.setState('ring.trigger', false, true)
                        }, 2500);
                    }
                }
            })();
            setTimeout(function () {
                ringActive = false
            }, 500);
        }
    } else {
        return;
    }
}