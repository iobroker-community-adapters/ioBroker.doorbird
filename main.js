/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';


var utils = require(__dirname + '/lib/utils');
var birdConCheck;
var adapter = new utils.Adapter('doorbird');
var dgram = require('dgram');
var udpserver = dgram.createSocket('udp4');
// var _sodium = require('libsodium-wrappers'); - Not needed for now (DEP << "libsodium-wrappers": "^0.7.3" >> ALSO REMOVED IN PACKAGE FILE!!)
// var ringActive = false; - Not needed for now .. Just saving it for later .. maybe ...
var request = require('request');
var fs = require('fs');
var http = require('http');
var path = require('path');
var wizard = false;
var wizardTimeout = false;
var authorized = false;
var bellCount = 0;
var scheduleState = {};
var motionState = {};
var doorbellsArray = []; // Contains all Doorbell IDs
var favoriteState = {}; // {'ID of Doorbell/Motion': 'ID of Favorite'}
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
    if (!state || state.ack) return;
    var comp = id.split('.');
    if (comp[2] === 'Restart') {
        if (!authorized) {
            adapter.log.error('Cannot Restart DoorBird because not authorized!');
        } else {
            adapter.log.debug('Trying to restart DoorBird Device..');
            try {
                request(buildURL('restart'), function (error, response, body) {
                    if (!error) {
                        if (response.statusCode === 200) {
                            adapter.log.debug('DoorBird Device is now restarting!!');
                            adapter.setState(id, state, true);
                        } else if (response.statusCode === 503) {
                            adapter.log.error('DoorBird denied restart! (Device is busy and cannot restart now!)');
                        } else {
                            adapter.log.error('DoorBird denied restart! (Statuscode: ' + response.statusCode + ')')
                        }
                    } else {
                        adapter.log.error('DoorBird denied restart: ' + error)
                    }
                });
            } catch (e) {
                adapter.log.error('Error in restarting DoorBird: ' + e);
            }
        }
    }
    else if (comp[2] === 'Relays') {
        if (!authorized) {
            adapter.log.error('Cannot trigger relay because not authorized!');
        } else {
            try {
                request('http://' + adapter.config.birdip + '/bha-api/open-door.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw + '&r=' + comp[3], function (error, response, body) {
                    if (!error) {
                        if (response.statusCode === 200) {
                            adapter.log.debug('Relay ' + comp[3] + ' triggered successfully!');
                            adapter.setState(id, state, true);
                        } else if (response.statusCode === 204) {
                            adapter.log.error('Could not trigger relay ' + comp[3] + '! (Insufficient permissions)');
                        } else {
                            adapter.log.error('Could not trigger relay ' + comp[3] + '. (Got Statuscode ' + response.statusCode + ')');
                        }
                    }
                });
            } catch (e) {
                adapter.log.error('Error in triggering Relay: ' + e);
            }
        }
    }
});


adapter.on('message', function (msg) {
    if (msg.command === 'wizard' && !wizard) {
        startWizard(msg);
        wizard = true;
    }
});


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


adapter.on('ready', function () {
    adapter.getForeignObject('system.config', (err, obj) => {
        if (obj && obj.native && obj.native.secret) {
            adapter.config.birdpw = decrypt(obj.native.secret, adapter.config.birdpw || 'empty');
        } else {
            adapter.config.birdpw = decrypt('Zgfr56gFe87jJOM', adapter.config.birdpw || 'empty');
        }
        adapter.setState('info.connection', false, true);
        main();
    });
});


function decrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}


function buildURL(com) {
    return 'http://' + adapter.config.birdip + '/bha-api/' + com + '.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw;
}


function testBird() {
    request(buildURL('schedule'), function (error, response, body) {
        if (!error) {
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
                        adapter.setState('info.type', info.BHA.VERSION[0]['DEVICE-TYPE'], true);
                        var relays = info.BHA.VERSION[0].RELAYS;
                        relays.forEach(function (value) {
                            adapter.setObjectNotExists('Relays.' + value, {
                                type: 'state',
                                common: {
                                    name: 'Activate relay',
                                    type: 'boolean',
                                    role: 'button',
                                    read: true,
                                    write: true,
                                    desc: 'Activate the Relay (ID: ' + value + ')',
                                },
                                native: {}
                            });
                        });
                    }
                }
                catch (e) {
                    adapter.log.error('Error in Parsing getInfo(): ' + e);
                }
                checkFavorites();
            } else {
                adapter.log.error('Error in getInfo(): ' + error);
            }
        });
    } else {
        adapter.log.error('Execution of getInfo not allowed because not authorized!');
    }
}

function updateFavorite(key, obj) {
    var newURL = obj.value.replace(/(?<=\/\/)(.*)(?=\/)/, adapter.config.adapterAddress + ':' + adapter.config.adapterport);
    request('http://' + adapter.config.birdip + '/bha-api/favorites.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw + '&action=save&type=http&id=' + key + '&title=' + obj.title + '&value=' + newURL, function (error, response, body) {
        if (!error && response.statusCode === 200) {
            adapter.log.debug('Favorite Updated successfully..');
            checkFavorites();
        } else {
            adapter.log.debug('There was an error while updating the Favorite! (' + error + ' ' + response.statusCode + ')');
        }
    });
}

function checkFavorites() {
    adapter.log.debug('Checking favorites on DoorBird Device..');
    request(buildURL('favorites'), function (error, response, body) {
        if (!error) {
            try {
                if (response.statusCode === 200) {
                    favoriteState = {};
                    var favorites = JSON.parse(body);
                    for (var key in favorites.http) {
                        if (!favorites.http.hasOwnProperty(key)) continue;
                        var obj = favorites.http[key];
                        if (obj.title.indexOf('ioBroker ' + adapter.namespace) != -1 && obj.value.indexOf(adapter.config.adapterAddress + ':' + adapter.config.adapterport) === -1) {
                            adapter.log.warn('The Favorite ID ' + key + ' contains a wrong URL (' + obj.value + ').. I will update that..');
                            updateFavorite(key, obj);
                            return;
                        }
                        if (obj.value.indexOf(adapter.config.adapterAddress + ':' + adapter.config.adapterport) != -1) {
                            adapter.log.debug('Found a Favorite that belongs to me..');
                            adapter.log.debug('(ID: ' + key + ') (' + obj.title + ": " + obj.value + ')');
                            if (!favoriteState[obj.title.split(' ')[2]]) {
                                favoriteState[obj.title.split(' ')[2]] = {};
                                favoriteState[obj.title.split(' ')[2]]['ID'] = key;
                                favoriteState[obj.title.split(' ')[2]]['URL'] = obj.value;
                            } else {
                                adapter.log.debug('Found a duplicate favorite! (ID : ' + key + ') Trying to delete the duplicate..');
                                request('http://' + adapter.config.birdip + '/bha-api/favorites.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw + '&action=remove&type=http&id=' + key, function (error, response, body) {
                                    if (!error && response.statusCode === 200) {
                                        adapter.log.debug('Deleted the duplicate (ID: ' + key + ') successfully!');
                                    } else {
                                        adapter.log.debug('I was unable to delete the duplicate! (ID: ' + key + ')');
                                    }
                                });
                            }
                        }
                    }
                    if (Object.keys(favoriteState).length === 0) {
                        adapter.log.debug('I did not find any Favorite on the DoorBird Device that belongs to me..');
                    } else {
                        adapter.log.debug('Result of Favorites: ' + JSON.stringify(favoriteState));
                    }
                    getSchedules();
                }
            }
            catch (e) {
                adapter.log.error('Error in Parsing favorites: ' + e);
            }
        } else {
            adapter.log.error('Error in getFavorites(): ' + error);
        }
    });
}


function getSchedules() {
    request(buildURL('schedule'), function (error, response, body) {
        if (!error) {
            try {
                if (response.statusCode === 200) {
                    scheduleState = {};
                    motionState = {};
                    var schedules = JSON.parse(body);
                    bellCount = 0;
                    doorbellsArray = [];
                    adapter.log.debug('Looping trough the Schedules..');
                    for (var i = 0; i < schedules.length; i++) {
                        if (schedules[i].input === "doorbell") {
                            bellCount++;
                            adapter.log.debug('Detected a Doorbell Schedule!');
                            scheduleState[schedules[i].param] = schedules[i].output;
                            adapter.log.debug('The Param of the actual Schedule is: ' + schedules[i].param);
                            doorbellsArray.push(schedules[i].param);
                            adapter.log.debug('The Output contains ' + schedules[i].output.length + ' entries!');
                            for (var k = 0; k < schedules[i].output.length; k++) {
                                adapter.log.debug('Entry "' + k + '" is: ' + JSON.stringify(schedules[i].output[k]));
                            }
                            adapter.log.debug('Counted ' + bellCount + ' Doorbells.');
                        }
                        if (schedules[i].input === "motion") {
                            adapter.log.debug('Detected Motion Schedule!');
                            motionState.output = schedules[i].output;
                            adapter.log.debug('The Output contains ' + schedules[i].output.length + ' entries!');
                            for (var k = 0; k < schedules[i].output.length; k++) {
                                adapter.log.debug('Entry "' + k + '" is: ' + JSON.stringify(schedules[i].output[k]));
                            }
                        }
                    }
                    createFavorites(0);
                }
            }
            catch (e) {
                adapter.log.error('Error in Parsing Schedules: ' + e);
            }
        } else {
            adapter.log.error('Error in getSchedules(): ' + error);
        }
    });
}



function createFavorites(i, action, motion) {
    adapter.log.debug('Checking if we need to create any favorites..');
    if (i < doorbellsArray.length && !motion) {
        adapter.log.debug('Cheking if Favorite for Doorbell ID ' + doorbellsArray[i] + ' exists.');
        if (favoriteState[doorbellsArray[i]]) {
            adapter.log.debug('Favorite for Doorbell ID ' + doorbellsArray[i] + ' exists!');
            i++
            createFavorites(i, false, false);
            return;
        }
        try {
            adapter.log.debug('Favorite for Doorbell ID ' + doorbellsArray[i] + ' has to be created!');
            request('http://' + adapter.config.birdip + '/bha-api/favorites.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw + '&action=save&type=http&title=ioBroker ' + adapter.namespace + ' ' + doorbellsArray[i] + ' Ring&value=http://' + adapter.config.adapterAddress + ':' + adapter.config.adapterport + '/ring?' + doorbellsArray[i], function (error, response, body) {
                if (!error) {
                    if (response.statusCode === 200) {
                        i++;
                        adapter.log.debug('Favorite created successfully..');
                        createFavorites(i, true, false);
                    }
                }
            });
            return;
        } catch (e) {
            adapter.log.error('Error in creating Favorite: ' + e);
        }
    }
    if (typeof favoriteState['Motion'] === 'undefined' && !motion) {
        request('http://' + adapter.config.birdip + '/bha-api/favorites.cgi?http-user=' + adapter.config.birduser + '&http-password=' + adapter.config.birdpw + '&action=save&type=http&title=ioBroker ' + adapter.namespace + ' Motion&value=http://' + adapter.config.adapterAddress + ':' + adapter.config.adapterport + '/motion', function (error, response, body) {
            if (!error) {
                if (response.statusCode === 200) {
                    adapter.log.debug('Favorite for Motionsensor created.');
                    createFavorites(i, true, true)
                }
            }
        });
        return;
    }
    if (action) {
        adapter.log.debug('Finished creating Favorites.. Checking again - just to be sure!');
        checkFavorites();
    } else {
        adapter.log.debug('Favorites checked successfully. No actions needed!');
        createSchedules();
    }
}


function createSchedules() {
    adapter.log.debug('Checking if we need to create Schedules on DoorBird Device..');
    for (var key in scheduleState) {
        var toCreate = {};
        if (scheduleState.hasOwnProperty(key)) {
            var actionNeeded = true;
            for (var i = 0; i < scheduleState[key].length; i++) {
                if (scheduleState[key][i].event !== 'http') {
                    continue;
                }
                if (scheduleState[key][i].param === favoriteState[key]['ID']) {
                    actionNeeded = false;
                }
            }
            if (actionNeeded) {
                var array = scheduleState[key];
                adapter.log.debug('We need to create a Schedule for Doorbell ID: ' + key);
                array.push({ "event": "http", "param": favoriteState[key]['ID'], "enabled": "1", "schedule": { "weekdays": [{ "from": "79200", "to": "79199" }] } });
                toCreate = { "input": "doorbell", "param": key, "output": array };
                request({
                    url: buildURL('schedule'),
                    method: "POST",
                    json: true,
                    body: toCreate
                }, function (error, response, body) {
                    if (!error && response.statusCode === 200) {
                        adapter.log.debug('Schedule created successful!');
                    } else {
                        adapter.log.error('There was an Error while creating the schedule..');
                        adapter.log.error(error + ' ' + response.statusCode);
                    }
                });
            } else {
                adapter.log.debug('Okay we dont need to create any Doorbell-Schedules..');
            }
        }
    }
    doorbellsArray.forEach(function (value) {
        adapter.setObjectNotExists('Doorbell.' + value + '.trigger', {
            type: 'state',
            common: {
                role: "indicator",
                name: "Doorbell ID '" + value + "' pressed",
                type: "boolean",
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        adapter.setObjectNotExists('Doorbell.' + value + '.snapshot', {
            type: 'state',
            common: {
                name: "JPG file",
                type: "file",
                read: true,
                write: false,
                desc: "Can be accessed from web server under http://ip:8082/state/doorbird.0.Doorbell." + value + ".snapshot"
            },
            "native": {}
        });
    });
    createMotionSchedule();
}


function createMotionSchedule() {
    for (var key in motionState) {
        var toCreate = {};
        if (motionState.hasOwnProperty(key)) {
            var actionNeeded = true;
            for (var i = 0; i < motionState[key].length; i++) {
                if (motionState[key][i].event !== 'http') {
                    continue;
                }
                if (motionState[key][i].param === favoriteState['Motion']['ID']) {
                    actionNeeded = false;
                }
            }
            if (actionNeeded) {
                var array = motionState[key];
                adapter.log.debug('We need to create a Schedule for the Motion Sensor!');
                array.push({ "event": "http", "param": favoriteState['Motion']['ID'], "enabled": "1", "schedule": { "weekdays": [{ "from": "79200", "to": "79199" }] } });
                toCreate = { "input": "motion", "param": "", "output": array };
                request({
                    url: buildURL('schedule'),
                    method: "POST",
                    json: true,
                    body: toCreate
                }, function (error, response, body) {
                    if (!error && response.statusCode === 200) {
                        adapter.log.debug('Schedule for Motionsensor set successful!');
                    } else {
                        adapter.log.error('There was an Error while setting the Motion schedule..');
                        adapter.log.error(error + ' (Statuscode: ' + response.statusCode + ')');
                    }
                });
            }
        }
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
    if (adapter.config.adapterAddress) {
        try {
            http.createServer(function (req, res) {
                if (res.socket.remoteAddress.replace(/^.*:/, '') == adapter.config.birdip || res.socket.remoteAddress == '192.168.30.47') {
                    res.writeHead(204, { 'Content-Type': 'text/plain' });
                    if (req.url == '/motion') {
                        adapter.log.debug('Received Motion-alert from Doorbird!');
                        adapter.setState('Motion.trigger', true, true);
                        download(buildURL('image'), jpgpath, function () {
                            adapter.log.debug('Image downloaded!');
                            sendToState('Motion');
                        });
                        setTimeout(function () {
                            adapter.setState('Motion.trigger', false, true)
                        }, 2500);
                    }
                    if (req.url.indexOf('ring') != -1) {
                        var id = req.url.substr(req.url.indexOf('?') + 1, req.url.length);
                        adapter.log.debug('Received Ring-alert (ID: ' + id + ') from Doorbird!');
                        adapter.setState('Doorbell.' + id + '.trigger', true, true);
                        download(buildURL('image'), jpgpath, function () {
                            adapter.log.debug('Image downloaded!');
                            sendToState('Doorbell.' + id);
                        });
                        setTimeout(function () {
                            adapter.setState('Doorbell.' + id + '.trigger', false, true)
                        }, 2500);
                    }
                    res.end();
                } else {
                    res.writeHead(401, { 'Content-Type': 'text/plain' });
                    res.end();
                }
            }).listen(adapter.config.adapterport || 8100, adapter.config.adapterAddress);
        } catch (e) {
            adapter.log.error('There was an Error starting the HTTP Server! (' + e + ')');
        }
    } else {
        adapter.log.error('You need to set the Adapteraddress in the Instance-Settings!!');
    }

    adapter.subscribeStates('*');
}


/* function decryptDoorBird(message) {
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
} */
