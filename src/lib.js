"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProvisioningProfiles = exports.createProvisioningProfiles = exports.deleteAppStoreConnectApiKeyFile = exports.createAppStoreConnectApiKeyFile = exports.deleteKeychain = exports.createKeychain = exports.getIdentity = exports.getDestination = exports.actionIsTestable = exports.getAction = exports.getConfiguration = exports.verbosity = exports.getSchemeFromPackage = exports.xcselect = exports.spawn = void 0;
const core = __importStar(require("@actions/core"));
const gha_exec = __importStar(require("@actions/exec"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const semver_1 = __importStar(require("semver"));
async function mdls(path) {
    try {
        const v = await exec('mdls', ['-raw', '-name', 'kMDItemVersion', path]);
        if (core.getInput('verbosity') == 'verbose') {
            // in verbose mode all commands and outputs are printed
            // and mdls in `raw` mode does not terminate its lines
            process.stdout.write('\n');
        }
        return semver_1.default.coerce(v) ?? undefined;
    }
    catch (e) {
        const match = path.match(/Xcode_(.*)\.app/);
        if (match?.[1]) {
            return semver_1.default.coerce(match[1]);
        }
    }
}
async function xcodes() {
    const paths = await (async () => {
        const output = await exec('mdfind', [
            'kMDItemCFBundleIdentifier = com.apple.dt.Xcode',
        ]).catch(() => '');
        const rv = output
            .split('\n')
            .map((path) => path.trim())
            .filter((x) => x);
        if (rv.length == 0) {
            for (const entry of fs.readdirSync('/Applications')) {
                if (!/Xcode.*\.app$/.test(entry))
                    continue;
                rv.push(path.join('/Applications', entry));
            }
        }
        return rv;
    })();
    const rv = [];
    for (const path of paths) {
        if (!path.trim())
            continue;
        const v = await mdls(path);
        if (v) {
            rv.push([path, v]);
        }
    }
    return rv;
}
function spawn(arg0, args, options = { stdio: 'inherit' }) {
    const { error, signal, status } = (0, child_process_1.spawnSync)(arg0, args, options);
    if (error)
        throw error;
    if (signal)
        throw new Error(`\`${arg0}\` terminated with signal (${signal})`);
    if (status != 0)
        throw new Error(`\`${arg0}\` aborted (${status})`);
}
exports.spawn = spawn;
async function xcselect(xcode, swift) {
    if (swift) {
        return selectSwift(swift);
    }
    else if (xcode) {
        return selectXcode(xcode);
    }
    const gotDotSwiftVersion = dotSwiftVersion();
    if (gotDotSwiftVersion) {
        core.info(`» \`.swift-version\` » ~> ${gotDotSwiftVersion}`);
        return selectSwift(gotDotSwiftVersion);
    }
    else {
        // figure out the GHA image default Xcode’s version
        const devdir = await exec('xcode-select', ['--print-path']);
        const xcodePath = path.dirname(path.dirname(devdir));
        const version = await mdls(xcodePath);
        if (version) {
            return version;
        }
        else {
            // shouldn’t happen, but this action needs to know the Xcode version
            // or we cannot function, this way we are #continuously-resilient
            return selectXcode();
        }
    }
    async function selectXcode(range) {
        const rv = (await xcodes())
            .filter(([, v]) => (range ? semver_1.default.satisfies(v, range) : true))
            .sort((a, b) => semver_1.default.compare(a[1], b[1]))
            .pop();
        if (!rv)
            throw new Error(`No Xcode ~> ${range}`);
        spawn('sudo', ['xcode-select', '--switch', rv[0]]);
        return rv[1];
    }
    async function selectSwift(range) {
        const rv1 = await xcodes();
        const rv2 = await Promise.all(rv1.map(swiftVersion));
        const rv3 = rv2
            .filter(([, , sv]) => semver_1.default.satisfies(sv, range))
            .sort((a, b) => semver_1.default.compare(a[1], b[1]))
            .pop();
        if (!rv3)
            throw new Error(`No Xcode with Swift ~> ${range} (Xcodes: ${rv1.join(',')} (Swifts: ${rv2.join(',')})`);
        core.info(`» Selected Swift ${rv3[2]}`);
        spawn('sudo', ['xcode-select', '--switch', rv3[0]]);
        return rv3[1];
        async function swiftVersion([DEVELOPER_DIR, xcodeVersion]) {
            // This command emits 'swift-driver version: ...' to stderr.
            const stdout = await exec('swift', ['--version'], { DEVELOPER_DIR }, false);
            const matches = stdout.match(/Swift version (.+?)\s/m);
            if (!matches || !matches[1])
                throw new Error(`failed to extract Swift version from Xcode ${xcodeVersion}`);
            const version = semver_1.default.coerce(matches[1]);
            if (!version)
                throw new Error(`failed to parse Swift version from Xcode ${xcodeVersion}`);
            return [DEVELOPER_DIR, xcodeVersion, version];
        }
    }
    function dotSwiftVersion() {
        if (!fs.existsSync('.swift-version'))
            return undefined;
        const version = fs.readFileSync('.swift-version').toString().trim();
        try {
            // A .swift-version of '5.0' indicates a SemVer Range of '>=5.0.0 <5.1.0'
            return new semver_1.Range('~' + version);
        }
        catch (error) {
            core.warning(`Failed to parse Swift version from .swift-version: ${error}`);
        }
    }
}
exports.xcselect = xcselect;
async function getSchemeFromPackage(workspace) {
    let args = ['-list', '-json'];
    if (workspace)
        args = args.concat(['-workspace', workspace]);
    const out = await exec('xcodebuild', args);
    const json = parseJSON(out);
    const schemes = (json?.workspace ?? json?.project)?.schemes;
    if (!schemes || schemes.length == 0)
        throw new Error('Could not determine scheme');
    for (const scheme of schemes) {
        if (scheme.endsWith('-Package'))
            return scheme;
    }
    return schemes[0];
}
exports.getSchemeFromPackage = getSchemeFromPackage;
function parseJSON(input) {
    try {
        input = input.trim();
        // works around xcodebuild sometimes outputting this string in CI conditions
        const xcodebuildSucks = 'build session not created after 15 seconds - still waiting';
        if (input.endsWith(xcodebuildSucks)) {
            input = input.slice(0, -xcodebuildSucks.length);
        }
        return JSON.parse(input);
    }
    catch (error) {
        core.startGroup('JSON');
        core.error(input);
        core.endGroup();
        throw error;
    }
}
async function destination(deviceType, version) {
    const out = await exec('xcrun', [
        'simctl',
        'list',
        '--json',
        'devices',
        'available',
    ]);
    const devices = parseJSON(out).devices;
    // best match
    let bm;
    for (const opaqueIdentifier in devices) {
        const device = (devices[opaqueIdentifier] ?? [])[0];
        if (!device)
            continue;
        const [type, v] = parse(opaqueIdentifier);
        if (v &&
            type === deviceType &&
            (!version || version.test(v)) &&
            (!bm || semver_1.default.lt(bm.version, v))) {
            bm = { id: device.udid, name: device.name, version: v };
        }
    }
    return bm;
    function parse(key) {
        const [type, ...vv] = (key.split('.').pop() ?? '').split('-');
        const v = semver_1.default.coerce(vv.join('.'));
        return [type, v ?? undefined];
    }
}
async function exec(command, args, env, stdErrToWarning = true) {
    let out = '';
    try {
        await gha_exec.exec(command, args, {
            listeners: {
                stdout: (data) => (out += data.toString()),
                stderr: (data) => {
                    const message = `${command}: ${'\u001b[33m'}${data.toString()}`;
                    if (stdErrToWarning) {
                        core.warning(message);
                    }
                    else {
                        core.info(message);
                    }
                },
            },
            silent: verbosity() != 'verbose',
            env,
        });
        return out;
    }
    catch (error) {
        // help debug efforts by showing what we ran if there was an error
        core.info(`» ${command} ${args ? args.join(' \\\n') : ''}`);
        throw error;
    }
}
function verbosity() {
    const value = core.getInput('verbosity');
    switch (value) {
        case 'xcpretty':
        case 'xcbeautify':
        case 'quiet':
        case 'verbose':
            return value;
        default:
            // backwards compatability
            if (core.getBooleanInput('quiet'))
                return 'quiet';
            core.warning(`invalid value for \`verbosity\` (${value})`);
            return 'xcpretty';
    }
}
exports.verbosity = verbosity;
function getConfiguration() {
    const conf = core.getInput('configuration');
    switch (conf) {
        // both `.xcodeproj` and SwiftPM projects capitalize these
        // by default, and are case-sensitive. And for both if an
        // incorrect configuration is specified do not error, but
        // do not behave as expected instead.
        case 'debug':
            return 'Debug';
        case 'release':
            return 'Release';
        default:
            return conf;
    }
}
exports.getConfiguration = getConfiguration;
function getAction(xcodeVersion, platform) {
    const action = core.getInput('action');
    if (platform == 'watchOS' &&
        actionIsTestable(action) &&
        semver_1.default.lt(xcodeVersion, '12.5.0')) {
        core.notice('Setting `action=build` for Apple Watch / Xcode <12.5');
        return 'build';
    }
    return action ?? undefined;
}
exports.getAction = getAction;
function actionIsTestable(action) {
    return action == 'test' || action == 'build-for-testing';
}
exports.actionIsTestable = actionIsTestable;
async function getDestination(xcodeVersion, platform, platformVersion) {
    switch (platform) {
        case 'iOS':
        case 'tvOS':
        case 'watchOS':
        case 'visionOS': {
            const deviceType = platform === 'visionOS' ? 'xrOS' : platform;
            const dest = await destination(deviceType, platformVersion);
            if (!dest) {
                core.error(`Device not found (platform: ${platform}, version: ${platformVersion})`);
                return [];
            }
            core.info(`Selected device: ${dest.name} (${dest.version})`);
            return ['-destination', `id=${dest.id}`];
        }
        case 'macOS':
            return ['-destination', `platform=macOS`];
        case 'mac-catalyst':
            return ['-destination', `platform=macOS,variant=Mac Catalyst`];
        case undefined:
            if (semver_1.default.gte(xcodeVersion, '13.0.0')) {
                //FIXME should parse output from xcodebuild -showdestinations
                //NOTE `-json` doesn’t work
                // eg. the Package.swift could only allow iOS, assuming macOS is going to work OFTEN
                // but not ALWAYS
                return ['-destination', 'platform=macOS'];
            }
            else {
                return [];
            }
        default:
            throw new Error(`Invalid platform: ${platform}`);
    }
}
exports.getDestination = getDestination;
function getIdentity(identity, platform) {
    if (identity) {
        return `CODE_SIGN_IDENTITY="${identity}"`;
    }
    if (platform == 'mac-catalyst') {
        // Disable code signing for Mac Catalyst unless overridden.
        core.notice('Disabling code signing for Mac Catalyst.');
        return 'CODE_SIGN_IDENTITY=-';
    }
}
exports.getIdentity = getIdentity;
// In order to avoid exposure to command line audit logging, we pass commands in
// via stdin. We allow only one command at a time in an effort to avoid injection.
function security(...args) {
    for (const arg of args) {
        if (arg.includes('\n'))
            throw new Error('Invalid security argument');
    }
    const command = args.join(' ').concat('\n');
    spawn('/usr/bin/security', ['-i'], { input: command });
}
async function createKeychain(certificate, passphrase) {
    // The user should have already stored these as encrypted secrets, but we'll be paranoid on their behalf.
    core.setSecret(certificate);
    core.setSecret(passphrase);
    // Avoid using a well-known password.
    const password = (await exec('/usr/bin/uuidgen')).trim();
    core.setSecret(password);
    // Avoid using well-known paths.
    const name = (await exec('/usr/bin/uuidgen')).trim();
    core.setSecret(name);
    // Unfortunately, a keychain must be stored on disk. We remove it in a post action that calls deleteKeychain.
    const keychainPath = `${process.env.RUNNER_TEMP}/${name}.keychain-db`;
    core.saveState('keychainPath', keychainPath);
    const keychainSearchPath = (await exec('/usr/bin/security', ['list-keychains', '-d', 'user']))
        .split('\n')
        .map((value) => value.trim());
    core.saveState('keychainSearchPath', keychainSearchPath);
    core.info('Creating keychain');
    security('create-keychain', '-p', password, keychainPath);
    security('set-keychain-settings', '-lut', '21600', keychainPath);
    security('unlock-keychain', '-p', password, keychainPath);
    // Unfortunately, a certificate must be stored on disk in order to be imported. We remove it immediately after import.
    core.info('Importing certificate to keychain');
    const certificatePath = `${process.env.RUNNER_TEMP}/${name}.p12`;
    fs.writeFileSync(certificatePath, certificate, { encoding: 'base64' });
    try {
        security('import', certificatePath, '-P', passphrase, '-A', '-t', 'cert', '-f', 'pkcs12', '-x', '-k', keychainPath);
    }
    finally {
        fs.unlinkSync(certificatePath);
    }
    core.info('Updating keychain search path');
    security('list-keychains', '-d', 'user', '-s', keychainPath, ...keychainSearchPath);
}
exports.createKeychain = createKeychain;
function deleteKeychain() {
    const state = core.getState('keychainSearchPath');
    if (state) {
        const keychainSearchPath = JSON.parse(state);
        core.info('Restoring keychain search path');
        try {
            security('list-keychains', '-d', 'user', '-s', ...keychainSearchPath);
        }
        catch (error) {
            core.error('Failed to restore keychain search path: ' + error);
            // Continue cleaning up.
        }
    }
    const keychainPath = core.getState('keychainPath');
    if (keychainPath) {
        core.info('Deleting keychain');
        try {
            security('delete-keychain', keychainPath);
        }
        catch (error) {
            core.error('Failed to delete keychain: ' + error);
            // Best we can do is deleting the keychain file.
            if (fs.existsSync(keychainPath)) {
                fs.unlinkSync(keychainPath);
            }
        }
    }
}
exports.deleteKeychain = deleteKeychain;
async function createAppStoreConnectApiKeyFile(key) {
    // Avoid using a well-known path.
    const name = (await exec('/usr/bin/uuidgen')).trim();
    core.setSecret(name);
    // Unfortunately, the key must be stored on disk. We remove it in
    // a post action that calls deleteAppStoreConnectApiKeyFile.
    const keyPath = `${process.env.RUNNER_TEMP}/${name}.p8`;
    core.saveState('keyPath', keyPath);
    core.info('Creating App Store Connect API key file');
    fs.writeFileSync(keyPath, key, { encoding: 'base64' });
    return keyPath;
}
exports.createAppStoreConnectApiKeyFile = createAppStoreConnectApiKeyFile;
function deleteAppStoreConnectApiKeyFile() {
    const keyPath = core.getState('keyPath');
    if (keyPath && fs.existsSync(keyPath)) {
        core.info('Deleting App Store Connect API key file');
        try {
            fs.unlinkSync(keyPath);
        }
        catch (error) {
            core.error('Failed to delete App Store Connect API key file: ' + error);
        }
    }
}
exports.deleteAppStoreConnectApiKeyFile = deleteAppStoreConnectApiKeyFile;
async function createProvisioningProfiles(mobileProfiles, profiles) {
    core.info('Creating provisioning profiles');
    for (const profile of mobileProfiles) {
        await createProvisioningProfile(profile, '.mobileprovision');
    }
    for (const profile of profiles) {
        await createProvisioningProfile(profile, '.provisionprofile');
    }
}
exports.createProvisioningProfiles = createProvisioningProfiles;
async function createProvisioningProfile(profile, extension) {
    // Avoid using a well-known path.
    const name = (await exec('/usr/bin/uuidgen')).trim();
    core.setSecret(name);
    const directory = path.join(`${process.env.HOME}`, 'Library/MobileDevice/Provisioning Profiles');
    fs.mkdirSync(directory, { recursive: true });
    const profilePath = path.join(directory, name + extension);
    // Add the new profile path to the saved state so we can delete it in post.
    const state = JSON.parse(core.getState('provisioningProfilePaths') || '[]');
    state.push(profilePath);
    core.saveState('provisioningProfilePaths', state);
    fs.writeFileSync(profilePath, profile, { encoding: 'base64' });
}
function deleteProvisioningProfiles() {
    const state = core.getState('provisioningProfilePaths');
    if (!state)
        return;
    core.info('Deleting provisioning profiles');
    for (const path in JSON.parse(state)) {
        if (fs.existsSync(path)) {
            try {
                fs.unlinkSync(path);
            }
            catch (error) {
                core.error('Failed to delete provisioning profile: ' + error);
            }
        }
    }
}
exports.deleteProvisioningProfiles = deleteProvisioningProfiles;
