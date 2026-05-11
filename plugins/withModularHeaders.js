const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        'Podfile'
      );
      let podfile = fs.readFileSync(podfilePath, 'utf8');
      if (!podfile.includes('modular_headers_patched')) {
        podfile = podfile.replace(
          "use_expo_modules!",
          "use_expo_modules!\n  pod 'RNScreens', :modular_headers => true # modular_headers_patched"
        );
        fs.writeFileSync(podfilePath, podfile);
      }
      return config;
    },
  ]);
};
