'use strict';

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

const dgram = require('dgram');
const Axios = require('axios').default;
const fs = require('fs');
const http = require('http');
const path = require('path');
const udpserver = dgram.createSocket('udp4');
// var _sodium = require('libsodium-wrappers'); - Not needed for now (DEP << "libsodium-wrappers": "^0.7.3" >> ALSO REMOVED IN PACKAGE FILE!!)
// var ringActive = false; - Not needed for now .. Just saving it for later .. maybe ...

const devMode = true;

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
		this.sockets = [];
		this.bellCount = 0;
		this.scheduleState = {};
		this.motionState = {};
		this.doorbellsArray = []; // Contains all Doorbell IDs
		this.favoriteState = {}; // {'ID of Doorbell/Motion': 'ID of Favorite'}

		this.authorized = false;

		this.birdConCheck = null;
		this.wizard = false;
		this.wizardTimeout = null;

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

		await this.mainAsync();
	}

	async mainAsync() {
		if (this.config.birdip && this.config.birdpw && this.config.birduser) {
			await this.testBirdAsync();
		}

		try {
			udpserver.on('listening', () => {
				const address = udpserver.address();
				this.log.debug('Adapter listening on IP: ' + address + ' - UDP Port 35344');
			});
		} catch (error) {
			this.log.error(`address already in use ${this.config.adapterAddress}:${this.config.adapterport}: ${error}`);
		}

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
								await Promise.all([
									this.setStateAsync('Motion.trigger', true, true),
									this.downloadFileAsync(this.buildURL('image'), this.jpgpath, 'Motion'),
								]);

								this.setTimeout(async () => {
									await this.setStateAsync('Motion.trigger', false, true);
								}, 2500);
							}
							if (req.url && req.url.indexOf('ring') != -1) {
								const id = req.url.substring(req.url.indexOf('?') + 1, req.url.length);
								this.log.debug('Received Ring-alert (ID: ' + id + ') from Doorbird!');
								await Promise.all([
									this.setStateAsync('Doorbell.' + id + '.trigger', true, true),
									this.downloadFileAsync(this.buildURL('image'), this.jpgpath, `Doorbell.${id}`),
								]);

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
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (!state || state.ack) return;
		const comp = id.split('.');
		if (comp[2] === 'Restart') {
			if (!this.authorized) {
				this.log.warn('Cannot Restart DoorBird because not authorized!');
			} else {
				this.log.debug('Trying to restart DoorBird Device..');
				try {
					const url = this.buildURL('restart');
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
			if (!this.authorized) {
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
			if (obj.command === 'wizard' && !this.wizard) {
				this.startWizard(obj);
				this.wizard = true;
			}
		}
	}

	/**
	 * @param {string} key
	 * @param {string} value
	 * @returns {string}
	 */
	decryption(key, value) {
		let result = '';
		for (let i = 0; i < value.length; ++i) {
			result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
		}
		return result;
	}

	/**
	 * Generate URL
	 * @param {'restart' | 'schedule' | 'info' | 'favorites' | 'image'} command
	 */
	buildURL(command) {
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

	/**
	 * Check Doorbird Connection
	 * @async
	 */
	async testBirdAsync() {
		try {
			const url = this.buildURL('schedule');
			const response = await Axios.get(url);

			if (response.status === 401) {
				this.authorized = false;
				await this.setStateAsync('info.connection', false, true);
				this.log.warn('Whooops.. DoorBird says User ' + this.config.birduser + ' is unauthorized!!');
				this.log.warn('Check Username + Password and enable the "API-Operator" Permission for the User!!');
			} else if (response.status === 200) {
				this.authorized = true;
				await this.setStateAsync('info.connection', true, true);
				this.log.debug('Authorization with User ' + this.config.birduser + ' successful!');
				await this.getInfoAsync();
			}
		} catch (error) {
			if (error.code === 'EHOSTUNREACH') {
				this.authorized = false;
				await this.setStateAsync('info.connection', false, true);
				this.log.warn('DoorBird Device is offline!!');
			} else {
				this.authorized = false;
				await this.setStateAsync('info.connection', false, true);
				this.log.warn('Error in testBird() Request: ' + error);
			}
		}

		(() => {
			if (this.birdConCheck) {
				this.clearTimeout(this.birdConCheck);
				this.birdConCheck = null;
			}
		})();
		this.birdConCheck = this.setTimeout(async () => {
			this.log.debug(`Refresh connection check...`);
			await this.testBirdAsync();
		}, 180000);
	}

	/**
	 * Get Doorbird Info
	 * @async
	 */
	async getInfoAsync() {
		if (this.authorized) {
			try {
				const url = this.buildURL('info');
				const response = await Axios.get(url);

				if (response.status === 200) {
					const info = response.data;
					await this.setStateAsync('info.firmware', info.BHA.VERSION[0].FIRMWARE, true);
					await this.setStateAsync('info.build', info.BHA.VERSION[0].BUILD_NUMBER, true);
					await this.setStateAsync('info.type', info.BHA.VERSION[0]['DEVICE-TYPE'], true);

					const relays = info.BHA.VERSION[0].RELAYS;

					for (const value of relays) {
						//create channel
						await this.createObjectsAsync('Relays', 'channel', {
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
						await this.createObjectsAsync(`Relays.${value}`, 'state', {
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

			await this.checkFavoritesAsync();
		} else {
			this.log.warn('Execution of getInfo not allowed because not authorized!');
		}
	}

	/**
	 * Check Favorites
	 * @async
	 */
	async checkFavoritesAsync() {
		this.log.debug('Checking favorites on DoorBird Device..');
		try {
			const url = this.buildURL('favorites');
			const response = await Axios.get(url);

			if (response.status === 200) {
				try {
					const favorites = response.data;
					for (const key in favorites.http) {
						if (!Object.hasOwnProperty.call(favorites.http, key)) continue;
						const obj = favorites.http[key];
						//toDelete
						this.log.debug(`FavoritesHTTP: ${JSON.stringify(favorites.http)}`);
						if (
							obj.title.indexOf('ioBroker ' + this.namespace) !== -1 &&
							obj.value.indexOf(this.config.adapterAddress + ':' + this.config.adapterport) === -1
						) {
							this.log.warn(
								`The Favorite ID '${key}' contains a wrong URL ('${obj.value}').. I will update that..`,
							);
							await this.updateFavoriteAsync(key, obj);
							return;
						}
						if (obj.value.indexOf(this.config.adapterAddress + ':' + this.config.adapterport) !== -1) {
							this.log.debug('Found a Favorite that belongs to me..');
							this.log.debug(`(ID: '${key}') ('${obj.title}': '${obj.value}')`);

							if (!this.favoriteState[obj.title.split(' ')[2]]) {
								this.favoriteState[obj.title.split(' ')[2]] = {};
								this.favoriteState[obj.title.split(' ')[2]]['ID'] = key;
								this.favoriteState[obj.title.split(' ')[2]]['URL'] = obj.value;
								//toDelete
								this.log.debug(
									`Create FavoriteState: ID: ${
										this.favoriteState[obj.title.split(' ')[2]]['ID']
									}, URL: ${this.favoriteState[obj.title.split(' ')[2]]['URL']}`,
								);
							} else {
								this.log.warn(
									`Found a duplicate favorite! (ID : '${key}') Split ${
										this.favoriteState[obj.title.split(' ')]
									}`,
								);

								if (devMode) {
									this.log.warn(
										`deleting duplicates is currently in dev-mode. Please delete duplicates yourself via the Doorbird app.`,
									);
								} else {
									this.log.debug(`Trying to delete the duplicate..`);

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
										this.log.warn(`I was unable to delete the duplicate! (ID: ${key})`);
									}
								}
							}
						}
					}
					if (Object.keys(this.favoriteState).length === 0) {
						this.log.debug('I did not find any Favorite on the DoorBird Device that belongs to me.');
					} else {
						this.log.debug(`Result of Favorites: ${JSON.stringify(this.favoriteState)}`);
					}
					await this.getSchedulesAsync();
					return true;
				} catch (error) {
					this.log.warn(`Error in Parsing favorites: ${error}`);
					return;
				}
			}
		} catch (error) {
			this.log.warn(`Error in getFavorites(): ${error}`);
			return;
		}
	}

	/**
	 * Update Favorites
	 * @async
	 * @param {number | string} key
	 * @param {object} obj
	 */
	async updateFavoriteAsync(key, obj) {
		const newURL = obj.value.replace(
			/(http:\/\/)(.*)(\/.*)/,
			'$1' + this.config.adapterAddress + ':' + this.config.adapterport + '$3',
		);

		//toDelete
		this.log.debug(`new for update: key: ${key}, title: ${obj.title}, url: ${newURL}`);

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
				this.log.debug('Favorite Updated successfully..');
				await this.checkFavoritesAsync();
			} else {
				this.log.warn(`There was an error while updating the Favorite! ${response.status}`);
			}
		} catch (error) {
			this.log.warn('There was an error while updating the Favorite! (' + error + ')');
		}
	}

	/**
	 * Get Schedules
	 * @async
	 */
	async getSchedulesAsync() {
		try {
			const url = this.buildURL('schedule');
			const response = await Axios.get(url);

			if (response.status === 200) {
				try {
					const schedules = response.data;
					this.bellCount = 0;
					this.log.debug(`Following schedules found: ${JSON.stringify(schedules)}`);
					this.log.debug('Looping through the Schedules..');

					for (let i = 0; i < schedules.length; i++) {
						if (schedules[i].input === 'doorbell') {
							this.bellCount++;
							this.log.debug('Detected a Doorbell Schedule!');
							this.scheduleState[schedules[i].param] = schedules[i].output;
							this.log.debug(`The Param of the actual Schedule is: ${schedules[i].param}`);
							this.doorbellsArray.push(schedules[i].param);
							this.log.debug(`The Output contains ${schedules[i].output.length} entries!`);

							for (let k = 0; k < schedules[i].output.length; k++) {
								this.log.debug(`Entry "${k}" is: ${JSON.stringify(schedules[i].output[k])}`);
							}

							this.log.debug(`Counted ${this.bellCount} Doorbells.`);
						}

						if (schedules[i].input === 'motion') {
							this.log.debug('Detected Motion Schedule!');
							this.motionState.output = schedules[i].output;
							this.log.debug(`The Output contains ${schedules[i].output.length} entries!`);

							for (let k = 0; k < schedules[i].output.length; k++) {
								this.log.debug(`Entry "${k}" is: ${JSON.stringify(schedules[i].output[k])}`);
							}
						}
					}

					await this.createFavoritesAsync(0);
				} catch (error) {
					this.log.warn(`Error in Parsing Schedules: ${error}`);
				}
			}
		} catch (error) {
			this.log.warn('Error in getSchedules(): ' + error);
		}
	}

	/**
	 * @async
	 * @param {number} i
	 * @param {boolean} [action = false]
	 * @param {boolean} [motion = false]
	 * @returns
	 */
	async createFavoritesAsync(i, action, motion) {
		this.log.debug('Checking if we need to create any favorites..');
		if (i < this.doorbellsArray.length && !motion) {
			this.log.debug('Cheking if Favorite for Doorbell ID ' + this.doorbellsArray[i] + ' exists.');
			if (this.favoriteState[this.doorbellsArray[i]]) {
				this.log.debug(`Favorite for Doorbell ID ${this.doorbellsArray[i]} exists!`);
				i++;
				await this.createFavoritesAsync(i, false, false);
				return;
			}
			try {
				this.log.debug(`Favorite for Doorbell ID ${this.doorbellsArray[i]} has to be created!`);
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
					this.doorbellsArray[i] +
					' Ring&value=http://' +
					this.config.adapterAddress +
					':' +
					this.config.adapterport +
					'/ring?' +
					this.doorbellsArray[i];
				const response = await Axios.get(createUrl);

				if (response.status === 200) {
					i++;
					this.log.debug(`Favorite created successfully..`);
					await this.createFavoritesAsync(i, true, false);
				}
			} catch (error) {
				this.log.warn(`Error in creating Favorite: ${error}`);
			}
		}
		if (typeof this.favoriteState['Motion'] === 'undefined' && !motion) {
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
					await this.createFavoritesAsync(i, true, true);
				}
			} catch (error) {
				this.log.warn('Error creating favorite for Motionsensor: ' + error);
			}

			return;
		}
		if (action) {
			this.log.debug('Finished creating Favorites.. Checking again - just to be sure!');
			await this.checkFavoritesAsync();
		} else {
			this.log.debug('Favorites checked successfully. No actions needed!');
			await this.createSchedulesAsync();
		}
	}

	/**
	 * Create Schedules
	 * @async
	 */
	async createSchedulesAsync() {
		this.log.debug('Checking if we need to create Schedules on DoorBird Device..');
		for (const key in this.scheduleState) {
			if (Object.hasOwnProperty.call(this.scheduleState, key)) {
				let actionNeeded = true;
				for (let i = 0; i < this.scheduleState[key].length; i++) {
					if (this.scheduleState[key][i].event !== 'http') {
						continue;
					}
					if (this.scheduleState[key][i].param === this.favoriteState[key]['ID']) {
						actionNeeded = false;
					}
				}
				if (actionNeeded) {
					const array = this.scheduleState[key];
					this.log.debug('We need to create a Schedule for Doorbell ID: ' + key);
					array.push({
						event: 'http',
						param: this.favoriteState[key]['ID'],
						enabled: '1',
						schedule: { weekdays: [{ from: '79200', to: '79199' }] },
					});
					this.toCreate = { input: 'doorbell', param: key, output: array };
					try {
						const createUrl = this.buildURL('schedule');
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

		for (const value of this.doorbellsArray) {
			await this.createObjectsAsync(`Doorbell.${value}`, 'device', {
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
			await this.createObjectsAsync(`Doorbell.${value}.trigger`, 'state', {
				role: 'indicator',
				name: "Doorbell ID '" + value + "' pressed",
				type: 'boolean',
				read: true,
				write: false,
				def: false,
			});

			await this.createObjectsAsync(`Doorbell.${value}.snapshot`, 'meta', {
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
			});
		}

		await this.createMotionScheduleAsync();
	}

	/**
	 * Create Motion Schedule
	 * @async
	 */
	async createMotionScheduleAsync() {
		for (const key in this.motionState) {
			if (Object.hasOwnProperty.call(this.motionState, key)) {
				let actionNeeded = true;
				for (let i = 0; i < this.motionState[key].length; i++) {
					if (this.motionState[key][i].event !== 'http') {
						continue;
					}
					if (this.motionState[key][i].param === this.favoriteState['Motion']['ID']) {
						actionNeeded = false;
					}
				}
				if (actionNeeded) {
					const array = this.motionState[key];
					this.log.debug('We need to create a Schedule for the Motion Sensor!');
					array.push({
						event: 'http',
						param: this.favoriteState['Motion']['ID'],
						enabled: '1',
						schedule: { weekdays: [{ from: '79200', to: '79199' }] },
					});
					const toCreate = { input: 'motion', param: '', output: array };
					try {
						const createUrl = this.buildURL('schedule');
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

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			if (this.birdConCheck) this.clearTimeout(this.birdConCheck);
			if (this.server)
				this.server.close(() => {
					this.log.debug(`Server closed`);
				});
			for (let i = 0; i < this.sockets.length; i++) {
				this.sockets[i].destroy();
			}
			this.sockets = [];
			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Wizard to find Doorbird
	 * @async
	 * @param {object} msg
	 */
	async startWizard(msg) {
		this.wizard = true;
		const wizData = [];
		const wizServer = dgram.createSocket('udp4');
		const adapter = this;

		wizServer.on('listening', function () {
			const address = wizServer.address();
			adapter.log.debug(`Wizard listening on IP: ${address.address} - UDP Port 6524`);
		});

		wizServer.on('message', (message, remote) => {
			if (remote.address && message.length > 25 && wizData.length == 0) {
				wizData.push(remote.address);
			}
			if (wizData[0] == remote.address && message.length < 25) {
				wizData.push(message.toString('utf-8').split(':')[1]);
				this.sendTo(msg.from, msg.command, wizData, msg.callback);
				this.wizard = false;
				(() => {
					if (this.wizardTimeout) {
						this.clearTimeout(this.wizardTimeout);
						this.wizardTimeout = null;
					}
				})();
				if (this.wizardTimeout) this.clearTimeout(this.wizardTimeout);
				wizServer.close();
			}
		});

		wizServer.bind(6524);
		if (this.wizardTimeout) this.clearTimeout(this.wizardTimeout);
		this.wizardTimeout = this.setTimeout(function () {
			wizServer.close();
			this.wizard = false;
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

	/**
	 * Download File from Doorbird
	 * @async
	 * @param {string} url
	 * @param {string} filename
	 * @param {string} cmd
	 */
	async downloadFileAsync(url, filename, cmd) {
		try {
			const response = await Axios.head(url);
			await Axios.get(url, { responseType: 'stream' }).then(async (res) => {
				res.data.pipe(fs.createWriteStream(filename)).on('close', () => {
					this.log.debug(`File downloaded successfully!`);
					this.log.debug(`Response status code: ${response.status}`);
					this.log.debug(`Response headers: ${response.headers}`);
				});
			});

			await this.sendToStateAsync(cmd);
		} catch (error) {
			console.log('Error downloading file:', error);
		}
	}

	/**
	 * Send File to Meta State
	 * @async
	 * @param {string} cmd
	 * @returns
	 */
	async sendToStateAsync(cmd) {
		let fileData;
		try {
			fileData = fs.readFileSync(this.jpgpath);
			await this.writeFileAsync(`${this.namespace}.${cmd}.snapshot`, 'snapshot.jpg', fileData);
			this.log.debug('Snapshot sent to State!');
			return true;
		} catch (e) {
			this.log.warn('Cannot upload JPG to State: ' + e);
			return;
		}
	}

	/**
	 * Create datapoint and update datapoints
	 * @async
	 * @param {string} dp path to datapoint
	 * @param {'device' | 'channel' | 'state' | 'meta'} type type of object
	 * @param {ioBroker.StateCommon | ioBroker.ChannelCommon | ioBroker.DeviceCommon} common common part of object
	 * @param {boolean} [foreign = false] set adapter states = false; set foreign states = true
	 */
	async createObjectsAsync(dp, type, common, foreign) {
		const obj = !foreign ? await this.getObjectAsync(dp) : await this.getForeignObjectAsync(dp);

		if (!obj) {
			const obj = {
				_id: dp,
				type: type,
				common: common,
				native: {},
			};
			// @ts-expect-error
			await (foreign ? this.setForeignObjectAsync(dp, obj) : this.setObjectAsync(dp, obj));
			this.log.debug(`Object: ${dp} created.`);
		} else {
			if (JSON.stringify(obj.common) !== JSON.stringify(common) || !('native' in obj)) {
				obj.common = common;
				obj.native = obj.native ?? {};
				await (foreign ? this.setForeignObjectAsync(dp, obj) : this.setObjectAsync(dp, obj));
				this.log.debug(`Object: ${dp} updated.`);
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
