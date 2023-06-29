'use strict';

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

let birdConCheck;
const dgram = require('dgram');
const Axios = require('axios').default;
const fs = require('fs');
const http = require('http');
const path = require('path');
const udpserver = dgram.createSocket('udp4');
// var _sodium = require('libsodium-wrappers'); - Not needed for now (DEP << "libsodium-wrappers": "^0.7.3" >> ALSO REMOVED IN PACKAGE FILE!!)
// var ringActive = false; - Not needed for now .. Just saving it for later .. maybe ...
let wizard = false;
let wizardTimeout = null;
let bellCount = 0;
let authorized = false;
const scheduleState = {};
const motionState = {};
const doorbellsArray = []; // Contains all Doorbell IDs
const favoriteState = {}; // {'ID of Doorbell/Motion': 'ID of Favorite'}
class Doorbird extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'doorbird',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		this.instanceDir = utils.getAbsoluteInstanceDataDir(this);
		this.jpgpath = path.join(utils.getAbsoluteInstanceDataDir(this), 'snap.jpg');

		if (!fs.existsSync(this.instanceDir)) {
			fs.mkdirSync(this.instanceDir);
		}
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Reset the connection indicator during startup
		await this.setStateAsync('info.connection', false, true);

		this.log.debug(this.instanceDir);
		this.log.debug(this.jpgpath);

		const systemConfig = await this.getForeignObjectAsync('system.config');

		if (systemConfig && systemConfig.native && systemConfig.native.secret) {
			this.config.birdpw = await this.decryption(systemConfig.native.secret, this.config.birdpw || 'empty');
		} else {
			this.config.birdpw = await this.decryption('Zgfr56gFe87jJOM', this.config.birdpw || 'empty');
		}

		await this.main();
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (!state || state.ack) return;
		const comp = id.split('.');
		if (comp[2] === 'Restart') {
			if (!authorized) {
				this.log.warn('Cannot Restart DoorBird because not authorized!');
			} else {
				this.log.debug('Trying to restart DoorBird Device..');
				try {
					const url = await this.buildURL('restart');
					const response = await Axios.get(url);

					if (response.status === 200) {
						this.log.debug('DoorBird Device is now restarting!!');
						await this.setStateAsync(id, state, true);
					} else if (response.status === 503) {
						this.log.warn('DoorBird denied restart! (Device is busy and cannot restart now!)');
					} else {
						this.log.warn('DoorBird denied restart! (Statuscode: ' + response.status + ')');
					}
				} catch (error) {
					this.log.warn('DoorBird denied restart: ' + error);
				}
			}
		} else if (comp[2] === 'Relays') {
			if (!authorized) {
				this.log.warn('Cannot trigger relay because not authorized!');
			} else {
				try {
					const url =
						'http://' +
						this.config.birdip +
						'/bha-api/open-door.cgi?http-user=' +
						this.config.birduser +
						'&http-password=' +
						this.config.birdpw +
						'&r=' +
						comp[3];

					const response = await Axios.get(url);

					if (response.status === 200) {
						this.log.debug('Relay ' + comp[3] + ' triggered successfully!');
						await this.setStateAsync(id, state, true);
					} else if (response.status === 204) {
						this.log.warn('Could not trigger relay ' + comp[3] + '! (Insufficient permissions)');
					} else {
						this.log.warn(
							'Could not trigger relay ' + comp[3] + '. (Got Statuscode ' + response.status + ')',
						);
					}
				} catch (error) {
					this.log.warn('Error in triggering Relay: ' + error);
				}
			}
		}
	}
	/**
	 * @param {ioBroker.Message} obj
	 */
	async onMessage(obj) {
		if (typeof obj === 'object' && obj.message) {
			if (obj.command === 'wizard' && !wizard) {
				this.startWizard(obj);
				wizard = true;
			}
		}
	}

	/**
	 * @param {string} key
	 * @param {string} value
	 * @returns {Promise<string>}
	 */
	async decryption(key, value) {
		let result = '';
		for (let i = 0; i < value.length; ++i) {
			result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
		}
		return result;
	}

	/**
	 * Generate URL
	 * @param {'restart' | 'schedule' | 'info' | 'favorites' | 'image'} command
	 * @returns {Promise<string>}
	 */
	async buildURL(command) {
		return (
			'http://' +
			this.config.birdip +
			'/bha-api/' +
			command +
			'.cgi?http-user=' +
			this.config.birduser +
			'&http-password=' +
			this.config.birdpw
		);
	}

	async testBird() {
		try {
			const url = await this.buildURL('schedule');
			const response = await Axios.get(url);

			if (response.status === 401) {
				authorized = false;
				await this.setStateAsync('info.connection', false, true);
				this.log.warn('Whooops.. DoorBird says User ' + this.config.birduser + ' is unauthorized!!');
				this.log.warn('Check Username + Password and enable the "API-Operator" Permission for the User!!');
			} else if (response.status === 200) {
				authorized = true;
				await this.setStateAsync('info.connection', true, true);
				this.log.debug('Authorization with User ' + this.config.birduser + ' successful!');
				this.getInfo();
			}
		} catch (error) {
			if (error.code === 'EHOSTUNREACH') {
				authorized = false;
				await this.setStateAsync('info.connection', false, true);
				this.log.warn('DoorBird Device is offline!!');
			} else {
				authorized = false;
				await this.setStateAsync('info.connection', false, true);
				this.log.warn('Error in testBird() Request: ' + error);
			}
		}

		return true;
	}

	async getInfo() {
		if (authorized) {
			try {
				const url = await this.buildURL('info');
				const response = await Axios.get(url);

				if (response.status === 200) {
					const info = response.data;
					await this.setStateAsync('info.firmware', info.BHA.VERSION[0].FIRMWARE, true);
					await this.setStateAsync('info.build', info.BHA.VERSION[0].BUILD_NUMBER, true);
					await this.setStateAsync('info.type', info.BHA.VERSION[0]['DEVICE-TYPE'], true);

					const relays = info.BHA.VERSION[0].RELAYS;

					for (const value of relays) {
						//create channel
						await this.createObjects('Relays', 'channel', {
							name: {
								en: 'Available Relays',
								de: 'Verfügbare Relais',
								ru: 'Доступные реле',
								pt: 'Relés disponíveis',
								nl: 'Available Relay',
								fr: 'Relais disponibles',
								it: 'Relè disponibili',
								es: 'Relés disponibles',
								pl: 'Dostępny Relay',
								uk: 'Доступні реле',
								'zh-cn': '现有费用',
							},
						});
						//create State
						await this.createObjects(`Relays.${value}`, 'state', {
							name: {
								en: 'Activate relay',
								de: 'Relais aktivieren',
								ru: 'Активировать реле',
								pt: 'Activar o relé',
								nl: 'Activeer relay',
								fr: 'Activer le relais',
								it: 'Attiva relè',
								es: 'Activar el relé',
								pl: 'Aktywacja',
								uk: 'Активувати реле',
								'zh-cn': '法 律 法 律 律 律 律 律 律 律 律 律 律 律 律 律 律 律 律 律 律 律 重',
							},
							type: 'boolean',
							role: 'button',
							read: false,
							write: true,
							desc: `ID: ${value}`,
						});
					}
				}
			} catch (error) {
				this.log.warn('Error in getInfo(): ' + error);
			}

			await this.checkFavorites();
		} else {
			this.log.warn('Execution of getInfo not allowed because not authorized!');
		}
	}

	async checkFavorites() {
		this.log.debug('Checking favorites on DoorBird Device..');
		try {
			const url = await this.buildURL('favorites');
			const response = await Axios.get(url);

			if (response.status === 200) {
				try {
					const favorites = response.data; // response.data ist bereits ein JSON-Objekt
					this.log.debug(`FavoritesObject: ${JSON.stringify(favorites)}`);
					for (const key in favorites.http) {
						if (!Object.hasOwnProperty.call(favorites.http, key)) continue;
						const obj = favorites.http[key];
						if (
							obj.title.indexOf('ioBroker ' + this.namespace) !== -1 &&
							obj.value.indexOf(this.config.adapterAddress + ':' + this.config.adapterport) === -1
						) {
							this.log.warn(
								`The Favorite ID '${key}' contains a wrong URL ('${obj.value}').. I will update that..`,
							);
							await this.updateFavorite(key, obj);
							return;
						}
						if (obj.value.indexOf(this.config.adapterAddress + ':' + this.config.adapterport) !== -1) {
							this.log.debug('Found a Favorite that belongs to me..');
							this.log.debug(`(ID: '${key}') ('${obj.title}': '${obj.value}')`);
							if (!favoriteState[obj.title.split(' ')[2]]) {
								favoriteState[obj.title.split(' ')[2]] = {};
								favoriteState[obj.title.split(' ')[2]]['ID'] = key;
								favoriteState[obj.title.split(' ')[2]]['URL'] = obj.value;
							} else {
								this.log.debug(
									`Found a duplicate favorite! (ID : '${key}') Trying to delete the duplicate..`,
								);
								const deleteUrl =
									'http://' +
									this.config.birdip +
									'/bha-api/favorites.cgi?http-user=' +
									this.config.birduser +
									'&http-password=' +
									this.config.birdpw +
									'&action=remove&type=http&id=' +
									key;
								const deleteResponse = await Axios.get(deleteUrl);
								if (deleteResponse.status === 200) {
									this.log.debug(`Deleted the duplicate (ID: '${key}') successfully!`);
								} else {
									this.log.debug(`I was unable to delete the duplicate! (ID: ${key})`);
								}
							}
						}
					}
					if (Object.keys(favoriteState).length === 0) {
						this.log.debug('I did not find any Favorite on the DoorBird Device that belongs to me.');
					} else {
						this.log.debug(`Result of Favorites: ${JSON.stringify(favoriteState)}`);
					}
					await this.getSchedules();
				} catch (error) {
					this.log.warn(`Error in Parsing favorites: ${error}`);
				}
			}
		} catch (error) {
			this.log.warn(`Error in getFavorites(): ${error}`);
		}
	}

	async updateFavorite(key, obj) {
		const newURL = obj.value.replace(
			/(http:\/\/)(.*)(\/.*)/,
			'$1' + this.config.adapterAddress + ':' + this.config.adapterport + '$3',
		);

		try {
			const url =
				'http://' +
				this.config.birdip +
				'/bha-api/favorites.cgi?http-user=' +
				this.config.birduser +
				'&http-password=' +
				this.config.birdpw +
				'&action=save&type=http&id=' +
				key +
				'&title=' +
				obj.title +
				'&value=' +
				newURL;

			const response = await Axios.get(url);

			if (response.status === 200) {
				this.log.warn('Favorite Updated successfully..');
				await this.checkFavorites();
			} else {
				this.log.warn(`There was an error while updating the Favorite! ${response.status}`);
			}
		} catch (error) {
			this.log.warn('There was an error while updating the Favorite! (' + error + ')');
		}
	}

	async getSchedules() {
		try {
			const url = await this.buildURL('schedule');
			const response = await Axios.get(url);

			if (response.status === 200) {
				try {
					const schedules = response.data;
					bellCount = 0;
					this.log.debug(`Following schedules found: ${JSON.stringify(schedules)}`);
					this.log.debug('Looping through the Schedules..');

					for (let i = 0; i < schedules.length; i++) {
						if (schedules[i].input === 'doorbell') {
							bellCount++;
							this.log.debug('Detected a Doorbell Schedule!');
							scheduleState[schedules[i].param] = schedules[i].output;
							this.log.debug(`The Param of the actual Schedule is: ${schedules[i].param}`);
							doorbellsArray.push(schedules[i].param);
							this.log.debug(`The Output contains ${schedules[i].output.length} entries!`);

							for (let k = 0; k < schedules[i].output.length; k++) {
								this.log.debug(`Entry "${k}" is: ${JSON.stringify(schedules[i].output[k])}`);
							}

							this.log.debug(`Counted ${bellCount} Doorbells.`);
						}

						if (schedules[i].input === 'motion') {
							this.log.debug('Detected Motion Schedule!');
							motionState.output = schedules[i].output;
							this.log.debug(`The Output contains ${schedules[i].output.length} entries!`);

							for (let k = 0; k < schedules[i].output.length; k++) {
								this.log.debug(`Entry "${k}" is: ${JSON.stringify(schedules[i].output[k])}`);
							}
						}
					}

					await this.createFavorites(0);
				} catch (error) {
					this.log.warn(`Error in Parsing Schedules: ${error}`);
				}
			}
		} catch (error) {
			this.log.warn('Error in getSchedules(): ' + error);
		}
	}

	async createFavorites(i, action, motion) {
		this.log.debug('Checking if we need to create any favorites..');
		if (i < doorbellsArray.length && !motion) {
			this.log.debug('Cheking if Favorite for Doorbell ID ' + doorbellsArray[i] + ' exists.');
			if (favoriteState[doorbellsArray[i]]) {
				this.log.debug(`Favorite for Doorbell ID ${doorbellsArray[i]} exists!`);
				i++;
				await this.createFavorites(i, false, false);
				return;
			}
			try {
				this.log.debug(`Favorite for Doorbell ID ${doorbellsArray[i]} has to be created!`);
				const createUrl =
					'http://' +
					this.config.birdip +
					'/bha-api/favorites.cgi?http-user=' +
					this.config.birduser +
					'&http-password=' +
					this.config.birdpw +
					'&action=save&type=http&title=ioBroker ' +
					this.namespace +
					' ' +
					doorbellsArray[i] +
					' Ring&value=http://' +
					this.config.adapterAddress +
					':' +
					this.config.adapterport +
					'/ring?' +
					doorbellsArray[i];
				const response = await Axios.get(createUrl);

				if (response.status === 200) {
					i++;
					this.log.debug(`Favorite created successfully..`);
					await this.createFavorites(i, true, false);
				}
			} catch (error) {
				this.log.warn(`Error in creating Favorite: ${error}`);
			}
		}
		if (typeof favoriteState['Motion'] === 'undefined' && !motion) {
			try {
				const url =
					'http://' +
					this.config.birdip +
					'/bha-api/favorites.cgi?http-user=' +
					this.config.birduser +
					'&http-password=' +
					this.config.birdpw +
					'&action=save&type=http&title=ioBroker ' +
					this.namespace +
					' Motion&value=http://' +
					this.config.adapterAddress +
					':' +
					this.config.adapterport +
					'/motion';

				const response = await Axios.get(url);

				if (response.status === 200) {
					this.log.debug('Favorite for Motionsensor created.');
					await this.createFavorites(i, true, true);
				}
			} catch (error) {
				this.log.warn('Error creating favorite for Motionsensor: ' + error);
			}

			return;
		}
		if (action) {
			this.log.debug('Finished creating Favorites.. Checking again - just to be sure!');
			await this.checkFavorites();
		} else {
			this.log.debug('Favorites checked successfully. No actions needed!');
			await this.createSchedules();
		}
	}

	async createSchedules() {
		this.log.debug('Checking if we need to create Schedules on DoorBird Device..');
		for (const key in scheduleState) {
			if (Object.hasOwnProperty.call(scheduleState, key)) {
				let actionNeeded = true;
				for (let i = 0; i < scheduleState[key].length; i++) {
					if (scheduleState[key][i].event !== 'http') {
						continue;
					}
					if (scheduleState[key][i].param === favoriteState[key]['ID']) {
						actionNeeded = false;
					}
				}
				if (actionNeeded) {
					const array = scheduleState[key];
					this.log.debug('We need to create a Schedule for Doorbell ID: ' + key);
					array.push({
						event: 'http',
						param: favoriteState[key]['ID'],
						enabled: '1',
						schedule: { weekdays: [{ from: '79200', to: '79199' }] },
					});
					this.toCreate = { input: 'doorbell', param: key, output: array };
					try {
						const createUrl = await this.buildURL('schedule');
						const response = await Axios.post(createUrl, this.toCreate);

						if (response.status === 200) {
							this.log.debug('Schedule created successfully!');
						} else {
							this.log.warn(
								`There was an Error while creating the schedule. Status: ${response.status}, Text: ${response.statusText}`,
							);
						}
					} catch (error) {
						this.log.warn(`Error in creating schedule: ${error}`);
					}
				} else {
					this.log.debug('Okay we dont need to create any Doorbell-Schedules..');
				}
			}
		}

		for (const value of doorbellsArray) {
			await this.createObjects(`Doorbell.${value}`, 'device', {
				name: {
					en: 'Doorbell',
					de: 'Türklingel',
					ru: 'Дверной звонок',
					pt: 'Campainha de porta',
					nl: 'Deur',
					fr: 'Doorbell',
					it: 'Campana porta',
					es: 'Doorbell',
					pl: 'Doorbell',
					uk: 'Рушники',
					'zh-cn': 'Doorbell',
				},
				desc: `ID: ${value}`,
			});
			//create State
			await this.createObjects(`Doorbell.${value}.trigger`, 'state', {
				role: 'indicator',
				name: "Doorbell ID '" + value + "' pressed",
				type: 'boolean',
				read: true,
				write: false,
				def: false,
			});
			await this.createObjects(
				`Doorbell.${value}.snapshot`,
				'meta',
				{
					name: {
						en: 'JPG File',
						de: 'JPG Datei',
						ru: 'ДЖП Файл',
						pt: 'JPG Arquivo',
						nl: 'JPG Veld',
						fr: 'JPG Fichier',
						it: 'JPG File',
						es: 'JPG Archivo',
						pl: 'JPG File',
						uk: 'JPG Головна',
						'zh-cn': 'J. 导 言 导 言',
					},
					// @ts-ignore
					type: 'meta.user',
				},
				true,
			);
		}

		await this.createMotionSchedule();
	}

	async createMotionSchedule() {
		for (const key in motionState) {
			if (Object.hasOwnProperty.call(motionState, key)) {
				let actionNeeded = true;
				for (let i = 0; i < motionState[key].length; i++) {
					if (motionState[key][i].event !== 'http') {
						continue;
					}
					if (motionState[key][i].param === favoriteState['Motion']['ID']) {
						actionNeeded = false;
					}
				}
				if (actionNeeded) {
					const array = motionState[key];
					this.log.debug('We need to create a Schedule for the Motion Sensor!');
					array.push({
						event: 'http',
						param: favoriteState['Motion']['ID'],
						enabled: '1',
						schedule: { weekdays: [{ from: '79200', to: '79199' }] },
					});
					const toCreate = { input: 'motion', param: '', output: array };
					try {
						const createUrl = await this.buildURL('schedule');
						const response = await Axios.post(createUrl, toCreate);

						if (response.status === 200) {
							this.log.debug('Schedule for Motion Sensor set successfully!');
						} else {
							this.log.warn(
								`There was an Error while setting the Motion schedule. (Statuscode: ${response.status}), (Statustext: ${response.statusText}`,
							);
						}
					} catch (error) {
						this.log.warn(`Error in setting Motion schedule: ${error}`);
					}
				}
			}
		}
	}

	async main() {
		if (this.config.birdip && this.config.birdpw && this.config.birduser) {
			await this.testBird();
			birdConCheck = setInterval(async () => {
				await this.testBird();
			}, 180000);
		}

		udpserver.on('listening', () => {
			const address = udpserver.address();
			this.log.debug('Adapter listening on IP: ' + address + ' - UDP Port 35344');
		});

		/*
		udpserver.on('message', function (msg, remote) {
			if (remote.address == adapter.config.birdip && !wizard) {
				adapter.decryptDoorBird(msg);
			}
		});
		*/

		// udpserver.bind(35344);
		if (this.config.adapterAddress) {
			try {
				this.server = http.createServer(async (req, res) => {
					if (res.socket && res.socket.remoteAddress) {
						const remoteAddress = res.socket.remoteAddress.replace(/^.*:/, '');
						if (remoteAddress === this.config.birdip || remoteAddress === '192.168.30.47') {
							res.writeHead(204, { 'Content-Type': 'text/plain' });
							if (req.url == '/motion') {
								this.log.debug('Received Motion-alert from Doorbird!');
								await this.setStateAsync('Motion.trigger', true, true);
								await this.downloadFile(await this.buildURL('image'), this.jpgpath, 'Motion');

								this.setTimeout(async () => {
									await this.setStateAsync('Motion.trigger', false, true);
								}, 2500);
							}
							if (req.url && req.url.indexOf('ring') != -1) {
								const id = req.url.substring(req.url.indexOf('?') + 1, req.url.length);
								this.log.debug('Received Ring-alert (ID: ' + id + ') from Doorbird!');
								await this.setStateAsync('Doorbell.' + id + '.trigger', true, true);

								await this.downloadFile(await this.buildURL('image'), this.jpgpath, 'Doorbell.' + id);

								this.setTimeout(async () => {
									await this.setStateAsync('Doorbell.' + id + '.trigger', false, true);
								}, 2000);
							}
							res.end();
						}
					} else {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end();
					}
				});

				this.server.listen(this.config.adapterport || 8081, this.config.adapterAddress, () => {
					this.log.debug(
						`Server gestartet auf Port ${this.config.adapterport || 8100} und IP ${
							this.config.adapterAddress
						}`,
					);
				});
			} catch (e) {
				this.log.warn('There was an Error starting the HTTP Server! (' + e + ')');
			}
		} else {
			this.log.warn('You need to set the Adapteraddress in the Instance-Settings!!');
		}

		this.subscribeStates('*');
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			clearInterval(birdConCheck);
			if (this.server) this.server.close();
			callback();
		} catch (e) {
			callback();
		}
	}

	async startWizard(msg) {
		wizard = true;
		const wizData = [];
		const wizServer = dgram.createSocket('udp4');
		const adapter = this;

		wizServer.on('listening', function () {
			const address = wizServer.address();
			adapter.log.debug(`Wizard listening on IP: ${address.address} - UDP Port 6524`);
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
		wizardTimeout = this.setTimeout(function () {
			wizServer.close();
			wizard = false;
			adapter.log.debug('Wizard timeout!');
		}, 60000);
	}

	/*
	async download(url, filename, callback) {
		try {
			request.head(url, function () {
				request(url).pipe(fs.createWriteStream(filename)).on('close', callback);
			});
		} catch (error) {
			this.log.warn(`Error by downloading file! ${error}`);
		}
	}
	*/

	async downloadFile(url, filename, cmd) {
		try {
			const response = await Axios.head(url);
			await Axios.get(url, { responseType: 'stream' }).then((res) => {
				res.data.pipe(fs.createWriteStream(filename)).on('close', () => {
					this.log.debug(`File downloaded successfully!`);
					// Hier können Sie den `response`-Parameter verwenden
					this.log.debug(`Response status code: ${response.status}`);
					this.log.debug(`Response headers: ${response.headers}`);
				});
			});

			await this.sendToState(cmd);
		} catch (error) {
			console.log('Error downloading file:', error);
		}
	}

	async sendToState(cmd) {
		let fileData;
		try {
			fileData = fs.readFileSync(this.jpgpath);
			await this.setForeignBinaryStateAsync(this.namespace + '.' + cmd + '.snapshot', fileData);
			this.log.debug('Snapshot sent to State!');
		} catch (e) {
			this.log.warn('Cannot upload JPG to State: ' + e);
			return;
		}
	}

	/**
	 * Create datapoint and update datapoints
	 * @author Schmakus
	 * @async
	 * @param {string} dp path to datapoint
	 * @param {'device' | 'channel' | 'state' | 'meta'} type type of object
	 * @param {ioBroker.StateCommon | ioBroker.ChannelCommon | ioBroker.DeviceCommon} common common part of object
	 * @param {boolean} [foreign = false] set adapter states = false; set foreign states = true
	 */
	async createObjects(dp, type, common, foreign) {
		const obj = !foreign ? await this.getObjectAsync(dp) : await this.getForeignObjectAsync(dp);

		if (!obj) {
			const obj = {
				type: type,
				common: common,
				native: {},
			};
			// @ts-expect-error
			await (foreign ? this.setForeignObjectAsync(dp, obj) : this.setObjectAsync(dp, obj));
			this.log.debug(`[ createObjects ] Object: ${dp} created.`);
		} else {
			if (JSON.stringify(obj.common) !== JSON.stringify(common) || !('native' in obj)) {
				obj.common = common;
				obj.native = obj.native ?? {};
				await (foreign ? this.setForeignObjectAsync(dp, obj) : this.setObjectAsync(dp, obj));
			}
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Doorbird(options);
} else {
	// otherwise start the instance directly
	new Doorbird();
}
