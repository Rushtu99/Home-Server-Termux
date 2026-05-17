#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/../utils/env.sh"

hs_orch_node_eval() {
  node - "$PROJECT" "$@" <<'NODE'
const projectRoot = process.argv[2];
const command = process.argv[3];
const target = process.argv[4] || '';
const { createDescriptorRegistry } = require(`${projectRoot}/backend/services/registry`);
const { resolveDependencyOrder } = require(`${projectRoot}/backend/orchestrator/graph`);
const registry = createDescriptorRegistry({ projectRoot });

if (command === 'cluster-services') {
  const name = registry.resolveClusterName(target);
  console.log((registry.clusterDescriptors[name]?.services || []).join('\n'));
} else if (command === 'cluster-order') {
  const name = registry.resolveClusterName(target);
  console.log(resolveDependencyOrder(registry.clusterConfig, name).join('\n'));
} else if (command === 'service-path') {
  const name = registry.resolveServiceName(target);
  console.log(registry.serviceDescriptors[name]?.directory || '');
} else {
  process.exit(2);
}
NODE
}

hs_orch_cluster_order() {
  hs_orch_node_eval cluster-order "${1:?cluster required}"
}

hs_orch_cluster_services() {
  hs_orch_node_eval cluster-services "${1:?cluster required}"
}

hs_orch_service_path() {
  hs_orch_node_eval service-path "${1:?service required}"
}

hs_orch_start_service() {
  "$PROJECT/hs" service start "${1:?service required}"
}

hs_orch_stop_service() {
  "$PROJECT/hs" service stop "${1:?service required}"
}

hs_orch_restart_service() {
  "$PROJECT/hs" service restart "${1:?service required}"
}

hs_orch_start_cluster() {
  "$PROJECT/hs" cluster start "${1:?cluster required}"
}

hs_orch_stop_cluster() {
  "$PROJECT/hs" cluster stop "${1:?cluster required}"
}

hs_orch_restart_cluster() {
  "$PROJECT/hs" cluster restart "${1:?cluster required}"
}
