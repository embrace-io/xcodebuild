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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const lib_1 = require("./lib");
const xcodebuild_1 = __importDefault(require("./xcodebuild"));
const artifact_1 = require("@actions/artifact");
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const semver_1 = __importStar(require("semver"));
//TODO we also need to set the right flags for other languages
const warningsAsErrorsFlags = 'OTHER_SWIFT_FLAGS=-warnings-as-errors';
async function main() {
    const cwd = core.getInput('working-directory');
    if (cwd) {
        process.chdir(cwd);
    }
    const swiftPM = fs.existsSync('Package.swift');
    const platform = getPlatformInput('platform');
    const platformVersion = getRangeInput('platform-version');
    const arch = getArchInput('arch');
    const selected = await (0, lib_1.xcselect)(getRangeInput('xcode'), getRangeInput('swift'));
    const action = (0, lib_1.getAction)(selected, platform);
    const configuration = (0, lib_1.getConfiguration)();
    const warningsAsErrors = core.getBooleanInput('warnings-as-errors');
    const destination = await (0, lib_1.getDestination)(selected, platform, platformVersion);
    const identity = (0, lib_1.getIdentity)(core.getInput('code-sign-identity'), platform);
    const currentVerbosity = (0, lib_1.verbosity)();
    const workspace = core.getInput('workspace');
    core.info(`» Selected Xcode ${selected}`);
    const reason = shouldGenerateXcodeproj();
    if (reason) {
        generateXcodeproj(reason);
    }
    const apiKey = await getAppStoreConnectApiKey();
    await configureKeychain();
    await configureProvisioningProfiles();
    await build(await getScheme(workspace), workspace, arch);
    if (core.getInput('upload-logs') == 'always') {
        await uploadLogs();
    }
    //// immediate funcs
    function getPlatformInput(input) {
        const value = core.getInput(input);
        if (!value)
            return undefined;
        return value;
    }
    function getArchInput(input) {
        const value = core.getInput(input);
        if (!value)
            return undefined;
        return value;
    }
    function getRangeInput(input) {
        const value = core.getInput(input);
        if (!value)
            return undefined;
        try {
            return new semver_1.Range(value);
        }
        catch (error) {
            throw new Error(`failed to parse semantic version range from '${value}': ${error}`);
        }
    }
    function shouldGenerateXcodeproj() {
        if (!swiftPM)
            return false;
        if (platform == 'watchOS' && semver_1.default.lt(selected, '12.5.0')) {
            // watchOS prior to 12.4 will fail to `xcodebuild` a SwiftPM project
            // failing trying to build the test modules, so we generate a project
            return 'Xcode <12.5 fails to build Swift Packages for watchOS if tests exist';
        }
        else if (semver_1.default.lt(selected, '11.0.0')) {
            return 'Xcode <11 cannot build';
        }
        else if (warningsAsErrors) {
            // `build` with SwiftPM projects will build the tests too, and if there are warnings in the
            // tests we will then fail to build (it's common that the tests may have ok warnings)
            //TODO only do this if there are test targets
            return '`warningsAsErrors` is set';
        }
        return false;
    }
    function generateXcodeproj(reason) {
        core.startGroup('Generating `.xcodeproj`');
        try {
            core.info(`Generating \`.xcodeproj\` ∵ ${reason}`);
            (0, lib_1.spawn)('swift', ['package', 'generate-xcodeproj']);
        }
        finally {
            core.endGroup();
        }
    }
    async function getAppStoreConnectApiKey() {
        const key = core.getInput('authentication-key-base64');
        if (!key)
            return;
        if (semver_1.default.lt(selected, '13.0.0')) {
            core.notice('Ignoring authentication-key-base64 because it requires Xcode 13 or later.');
            return;
        }
        const keyId = core.getInput('authentication-key-id');
        const keyIssuerId = core.getInput('authentication-key-issuer-id');
        if (!keyId || !keyIssuerId) {
            throw new Error('authentication-key-base64 requires authentication-key-id and authentication-key-issuer-id.');
        }
        // The user should have already stored these as encrypted secrets, but we'll
        // be paranoid on their behalf.
        core.setSecret(key);
        core.setSecret(keyId);
        core.setSecret(keyIssuerId);
        const keyPath = await (0, lib_1.createAppStoreConnectApiKeyFile)(key);
        return [
            '-allowProvisioningDeviceRegistration',
            '-allowProvisioningUpdates',
            '-authenticationKeyPath',
            keyPath,
            '-authenticationKeyID',
            keyId,
            '-authenticationKeyIssuerID',
            keyIssuerId,
        ];
    }
    async function configureKeychain() {
        const certificate = core.getInput('code-sign-certificate');
        if (!certificate)
            return;
        if (process.env.RUNNER_OS != 'macOS') {
            throw new Error('code-sign-certificate requires macOS.');
        }
        const passphrase = core.getInput('code-sign-certificate-passphrase');
        if (!passphrase) {
            throw new Error('code-sign-certificate requires code-sign-certificate-passphrase.');
        }
        await core.group('Configuring code signing', async () => {
            await (0, lib_1.createKeychain)(certificate, passphrase);
        });
    }
    async function configureProvisioningProfiles() {
        const mobileProfiles = core.getMultilineInput('mobile-provisioning-profiles-base64');
        const profiles = core.getMultilineInput('provisioning-profiles-base64');
        if (!mobileProfiles || !profiles)
            return;
        await (0, lib_1.createProvisioningProfiles)(mobileProfiles, profiles);
    }
    async function build(scheme, workspace, arch) {
        if (warningsAsErrors && (0, lib_1.actionIsTestable)(action)) {
            await xcodebuild('build', scheme, workspace, arch);
        }
        await xcodebuild(action, scheme, workspace, arch);
    }
    //// helper funcs
    async function xcodebuild(action, scheme, workspace, arch) {
        if (action === 'none')
            return;
        const title = ['xcodebuild', action].filter((x) => x).join(' ');
        await core.group(title, async () => {
            let args = destination;
            if (scheme)
                args = args.concat(['-scheme', scheme]);
            if (arch)
                args = args.concat([`-arch=${arch}`]);
            if (workspace)
                args = args.concat(['-workspace', workspace]);
            if (identity)
                args = args.concat(identity);
            if (currentVerbosity == 'quiet')
                args.push('-quiet');
            if (configuration)
                args = args.concat(['-configuration', configuration]);
            if (apiKey)
                args = args.concat(apiKey);
            args = args.concat([
                '-resultBundlePath',
                `${action ?? 'xcodebuild'}.xcresult`,
            ]);
            switch (action) {
                case 'build':
                    if (warningsAsErrors)
                        args.push(warningsAsErrorsFlags);
                    break;
                case 'test':
                case 'build-for-testing': {
                    if (core.getBooleanInput('code-coverage')) {
                        args = args.concat(['-enableCodeCoverage', 'YES']);
                    }
                    const sanitizer = core.getInput('sanitizer');
                    if (sanitizer === 'thread') {
                        args = args.concat(['-enableThreadSanitizer', 'YES']);
                    }
                    else if (sanitizer === 'address') {
                        args = args.concat(['-enableAddressSanitizer', 'YES']);
                    }
                    const testIterations = core.getInput('test-iterations');
                    if (testIterations) {
                        args = args.concat(['-test-iterations', testIterations]);
                    }
                    break;
                }
            }
            if (core.getBooleanInput('trust-plugins')) {
                args.push('-skipPackagePluginValidation');
            }
            if (action)
                args.push(action);
            await (0, xcodebuild_1.default)(args, currentVerbosity);
        });
    }
    //NOTE this is not nearly clever enough I think
    async function getScheme(workspace) {
        const scheme = core.getInput('scheme');
        if (scheme) {
            return scheme;
        }
        if (swiftPM) {
            return (0, lib_1.getSchemeFromPackage)(workspace);
        }
    }
}
function post() {
    (0, lib_1.deleteAppStoreConnectApiKeyFile)();
    (0, lib_1.deleteKeychain)();
    (0, lib_1.deleteProvisioningProfiles)();
}
async function run() {
    // We use the same entry point for `main` and `post` in action.yml in order to
    // avoid duplicating common logic. To differentiate at runtime, we set some
    // state in `main` for `post` to read.
    const isPost = Boolean(core.getState('isPost'));
    if (isPost) {
        post();
        return;
    }
    else {
        core.saveState('isPost', true);
    }
    try {
        await main();
    }
    catch (error) {
        await uploadLogs();
        const id = `${process.env.GITHUB_RUN_ID}`;
        const slug = process.env.GITHUB_REPOSITORY;
        const href = `https://github.com/${slug}/actions/runs/${id}#artifact`;
        core.warning(`
      We feel you.
      CI failures suck.
      Download the \`.xcresult\` files we just artifact’d.
      They *really* help diagnose what went wrong!
      ${href}
      `.replace(/\s+/g, ' '));
        throw error;
    }
}
run().catch((e) => {
    core.setFailed(e);
    if (e instanceof SyntaxError && e.stack) {
        core.error(e.stack);
    }
});
async function uploadLogs() {
    const getFiles = (directory) => fs
        .readdirSync(directory)
        .map((entry) => path.join(directory, entry))
        .flatMap((entry) => fs.lstatSync(entry).isDirectory() ? getFiles(entry) : [entry]);
    await core.group('Uploading Logs', async () => {
        const xcresults = fs
            .readdirSync('.')
            .filter((entry) => path.extname(entry) == '.xcresult');
        if (xcresults.length === 0) {
            core.warning('strange… no `.xcresult` bundles found');
        }
        const artifact = new artifact_1.DefaultArtifactClient();
        for (const xcresult of xcresults) {
            // random part because GitHub doesn’t yet expose any kind of per-job, per-matrix ID
            // https://github.community/t/add-build-number/16149/17
            const nonce = Math.random()
                .toString(36)
                .replace(/[^a-zA-Z0-9]+/g, '')
                .substr(0, 6);
            const base = path.basename(xcresult, '.xcresult');
            const name = `${base}-${process.env.GITHUB_RUN_NUMBER}.${nonce}.xcresult`;
            await artifact.uploadArtifact(name, getFiles(xcresult), '.');
        }
    });
}
