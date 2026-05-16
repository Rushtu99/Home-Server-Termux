const clusters = {
  media: {
    services: ['jellyfin', 'jellyseerr'],
    dependsOn: ['torrent', 'file'],
  },
  arr: {
    services: ['sonarr', 'radarr', 'bazarr', 'flarearr'],
    dependsOn: ['torrent'],
  },
  torrent: {
    services: ['qbittorrent'],
    dependsOn: [],
  },
  file: {
    services: ['mount-service'],
    dependsOn: [],
  },
  filemanagement: {
    services: ['fs-worker'],
    dependsOn: [],
  },
  analytics: {
    services: ['metrics-service', 'logging-service'],
    dependsOn: [],
  },
  localllm: {
    services: ['llama.cpp'],
    dependsOn: ['file'],
  },
  frontend: {
    services: ['nextjs-dashboard'],
    dependsOn: [],
  },
};

module.exports = {
  clusters,
};
