/**
 * Provider Manager - Coordinates discovery across pluggable providers.
 */

const OverpassProvider = require('./overpass');
const WebSearchProvider = require('./webSearch');
const RegionalRegistryProvider = require('./registry');
const GoogleMapsProvider = require('./googleMaps');
const FileImportProvider = require('./fileImport');

class DiscoveryEngine {
  constructor() {
    this.providers = [
      new GoogleMapsProvider(),
      new RegionalRegistryProvider(),
      new OverpassProvider(),
      new WebSearchProvider()
    ];
    this.fileImporter = new FileImportProvider();
  }

  getRegisteredProviders() {
    return this.providers.map(p => ({
      id: p.providerId,
      name: p.name
    }));
  }

  async runDiscovery(searchParams, onProgress = () => {}) {
    const allCandidates = [];
    const providersUsed = [];

    onProgress({
      step: 'STARTING_DISCOVERY',
      label: `Launching ${this.providers.length} discovery providers...`,
      status: 'RUNNING'
    });

    const tasks = this.providers.map(async (provider) => {
      try {
        onProgress({
          step: `PROVIDER_${provider.providerId.toUpperCase()}`,
          label: `Querying ${provider.name}...`,
          status: 'RUNNING'
        });

        const results = await provider.searchBusinesses(searchParams);
        providersUsed.push(provider.name);

        onProgress({
          step: `PROVIDER_${provider.providerId.toUpperCase()}`,
          label: `Completed ${provider.name} (Discovered ${results.length} candidates)`,
          status: 'DONE',
          count: results.length
        });

        return results;
      } catch (err) {
        console.error(`Provider ${provider.name} failed:`, err.message);
        onProgress({
          step: `PROVIDER_${provider.providerId.toUpperCase()}`,
          label: `${provider.name} error: ${err.message}`,
          status: 'WARNING'
        });
        return [];
      }
    });

    const settled = await Promise.allSettled(tasks);
    for (const res of settled) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        allCandidates.push(...res.value);
      }
    }

    return {
      candidates: allCandidates,
      providersUsed
    };
  }
}

module.exports = new DiscoveryEngine();
