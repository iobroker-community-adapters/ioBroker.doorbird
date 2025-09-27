# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

## Adapter-Specific Context

**Adapter Name:** doorbird
**Primary Function:** Connects DoorBird smart doorbells and intercoms to ioBroker
**Key Features:**
- Motion detection with image snapshots
- Doorbell ring detection with automatic photo capture
- Remote relay control (door opening, lights, etc.)
- Manual snapshot capture
- Device restart functionality
- Real-time event notifications via HTTP webhooks

**Key Dependencies:**
- DoorBird REST API for device communication
- HTTP server for receiving webhook notifications from DoorBird devices
- UDP discovery protocol for device detection wizard
- File system operations for snapshot storage

**Configuration Requirements:**
- DoorBird device IP address and credentials
- ioBroker adapter listening IP and port for webhooks
- Device-specific authentication (username/password)
- Encrypted password storage using ioBroker's native encryption

**Device Communication Patterns:**
- RESTful API calls to DoorBird device for control operations
- Webhook receiver for real-time event notifications (motion, doorbell)
- UDP broadcast listening for device discovery
- HTTP file downloads for snapshot images

## ioBroker Core Development Guidelines

### Adapter Lifecycle Management
Follow ioBroker adapter patterns for proper lifecycle management:

```javascript
class MyAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'your-adapter-name',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }

    async onReady() {
        // Initialize adapter
        await this.setState('info.connection', false, true);
        // Setup your adapter logic
    }

    onUnload(callback) {
        try {
            // Clean up timers, connections, etc.
            callback();
        } catch (e) {
            callback();
        }
    }
}
```

### State Management
- Use proper state creation with `setObjectNotExists()`
- Always set connection status in `info.connection`
- Use appropriate state roles (button, indicator, value, etc.)
- Include multilingual names for states when possible

### Error Handling and Logging
- Use structured logging with appropriate levels:
  - `this.log.error()` for critical errors
  - `this.log.warn()` for warnings and recoverable issues
  - `this.log.info()` for important operational information  
  - `this.log.debug()` for detailed debugging information
- Always handle errors gracefully without crashing the adapter
- Provide meaningful error messages for troubleshooting

### Configuration and Security
- Use `io-package.json` for configuration schema definition
- Mark sensitive fields in `protectedNative` and `encryptedNative`
- Validate configuration values before using them
- Provide sensible defaults for optional settings

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Validate expected states were created
                        const states = await harness.states.getKeysAsync('your-adapter.0.*');
                        console.log(`Found ${states.length} states`);
                        
                        if (states.length === 0) {
                            return reject(new Error('No states were created by the adapter'));
                        }

                        resolve();
                    } catch (error) {
                        console.error('Integration test failed:', error);
                        reject(error);
                    }
                });
            });
        });
    }
});
```

#### Required Integration Test Structure

**Critical Rule**: Integration tests MUST use `tests.integration()` and pass the adapter directory path as the first parameter.

```javascript
// ✅ CORRECT - This is the ONLY valid pattern
const path = require('path');
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        // Your test suites here
    }
});
```

**Common Errors to Avoid:**
```javascript
// ❌ WRONG - No arbitrary test structure
describe('My Custom Tests', () => {
    // This won't work with ioBroker testing
});

// ❌ WRONG - Don't try to start adapters manually
const startAdapter = require('some-custom-helper');
// Use harness.startAdapterAndWait() instead

// ❌ WRONG - Don't bypass harness for database operations
const objects = require('@iobroker/db-objects-redis');
// Use harness.objects and harness.states instead
```

#### Key Harness Methods

The test harness provides these essential methods:

```javascript
// Adapter control
await harness.startAdapter();           // Start the adapter
await harness.startAdapterAndWait();   // Start and wait for 'alive' state
harness.isAdapterRunning();            // Check if adapter is running

// Configuration
await harness.changeAdapterConfig('adapter', { native: { /* config */ } });

// State operations
await harness.states.getStateAsync('adapter.0.some.state');
await harness.states.setStateAsync('adapter.0.some.state', value);
const keys = await harness.states.getKeysAsync('adapter.0.*');

// Object operations  
await harness.objects.getObjectAsync('adapter.0.some.object');
await harness.objects.setObjectAsync('adapter.0.some.object', obj);
```

#### Timeout Configuration

Integration tests often need longer timeouts for adapter initialization:

```javascript
it('should complete complex initialization', function () {
    this.timeout(30000); // 30 seconds timeout
    
    return new Promise(async (resolve, reject) => {
        // Test implementation
    });
});
```

#### Error Handling in Tests

Always include proper error handling and logging:

```javascript
try {
    console.log('Starting test step...');
    await harness.startAdapterAndWait();
    console.log('✅ Adapter started successfully');
    
    // Add timeout for adapter processing
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Validate results
    const state = await harness.states.getStateAsync('adapter.0.info.connection');
    if (!state || state.val !== true) {
        throw new Error('Adapter did not connect properly');
    }
    
    console.log('✅ Test completed successfully');
} catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error; // Re-throw to fail the test
}
```

#### Package Testing

Always include package file validation:

```javascript
// test/package.js
const path = require('path');
const { tests } = require('@iobroker/testing');

// Validate the package files
tests.packageFiles(path.join(__dirname, '..'));
```

#### Complete Test Structure Example

```javascript
// test/integration.js
const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Custom adapter tests', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            // Test basic adapter functionality
            it('should start and create basic states', function () {
                this.timeout(20000);
                
                return new Promise(async (resolve, reject) => {
                    try {
                        await harness.startAdapterAndWait();
                        
                        // Wait for adapter to initialize
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        
                        // Check that basic states exist
                        const connectionState = await harness.states.getStateAsync('your-adapter.0.info.connection');
                        if (!connectionState) {
                            throw new Error('Connection state not found');
                        }
                        
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        });
    }
});
```

### Mocha Configuration

Use proper mocha configuration for ioBroker testing:

```javascript
// test/mocharc.custom.json
{
    "require": ["test/mocha.setup.js"],
    "timeout": 30000,
    "exit": true
}
```

And the setup file:

```javascript
// test/mocha.setup.js
// Don't silently swallow unhandled rejections
process.on('unhandledRejection', (e) => {
    throw e;
});

// enable the should interface with sinon
// and load chai-as-promised and sinon-chai by default
const sinonChai = require('sinon-chai');
const chaiAsPromised = require('chai-as-promised');
const { should, use } = require('chai');

should();
use(sinonChai);
use(chaiAsPromised);
```

### Adapter Resource Cleanup

Always implement proper cleanup in the `unload()` method:

```javascript
onUnload(callback) {
  try {
    // Clear any running timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    
    // Close server connections
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
    
    // Close any other connections
    if (this.connectionTimer) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = undefined;
    }
    // Close connections, clean up resources
    callback();
  } catch (e) {
    callback();
  }
}
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

## DoorBird-Specific Development Patterns

### HTTP Webhook Server Setup
The adapter listens for webhook notifications from DoorBird devices:

```javascript
// Setup HTTP server for webhooks
const http = require('http');
const server = http.createServer((req, res) => {
    if (req.url === '/motion') {
        // Handle motion detection
        this.setState('Motion.trigger', true, true);
        this.downloadFileAsync('Motion');
        
        // Reset trigger after delay
        setTimeout(() => {
            this.setState('Motion.trigger', false, true);
        }, 2500);
    }
    
    if (req.url && req.url.includes('ring')) {
        // Handle doorbell ring
        const id = req.url.substring(req.url.indexOf('?') + 1);
        this.setState(`Doorbell.${id}.trigger`, true, true);
        this.downloadFileAsync(`Doorbell${id}`);
    }
    
    res.writeHead(200);
    res.end();
});

server.listen(this.config.adapterport, this.config.adapterAddress);
```

### DoorBird API Communication
Use HTTP requests to communicate with DoorBird devices:

```javascript
// Example API call to DoorBird device
async function callDoorBirdAPI(endpoint) {
    const auth = Buffer.from(`${this.config.birduser}:${this.decrypt(this.config.birdpw)}`).toString('base64');
    
    const options = {
        hostname: this.config.birdip,
        path: endpoint,
        method: 'GET',
        headers: {
            'Authorization': `Basic ${auth}`
        },
        timeout: 10000
    };
    
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Request timeout')));
        req.end();
    });
}
```

### Device Discovery Implementation
Implement UDP-based device discovery:

```javascript
const dgram = require('dgram');

function startDeviceDiscovery() {
    const wizServer = dgram.createSocket('udp4');
    
    wizServer.on('listening', () => {
        const address = wizServer.address();
        this.log.debug(`Device discovery listening on ${address.address}:6524`);
    });
    
    wizServer.on('message', (message, remote) => {
        const text = message.toString('utf-8');
        if (remote.address && message.includes(':')) {
            const parts = text.split(':', 3);
            // parts[0] = port, parts[1] = device ID, parts[2] = timestamp
            
            // Return discovered device info
            this.sendDiscoveryResult({
                ip: remote.address,
                deviceId: parts[1]
            });
        }
    });
    
    wizServer.bind(6524);
    
    // Stop discovery after timeout
    setTimeout(() => {
        wizServer.close();
    }, 60000);
}
```

### Snapshot and File Handling
Handle image downloads from DoorBird devices:

```javascript
async function downloadFileAsync(type) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${type}_${timestamp}.jpg`;
        
        // Download image from DoorBird
        const imageData = await this.callDoorBirdAPI('/bha-api/image.cgi');
        
        // Save to ioBroker files
        await this.writeFileAsync('doorbird', filename, imageData);
        
        this.log.info(`Snapshot saved: ${filename}`);
    } catch (error) {
        this.log.error(`Failed to download snapshot: ${error.message}`);
    }
}
```