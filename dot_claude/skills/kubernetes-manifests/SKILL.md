---
name: kubernetes-manifests
description: Kubernetes manifest authoring guidelines. Load this skill when creating or reviewing Kubernetes manifests for any service. Covers when to use Kubernetes, manifest structure, resource limits, health probes, and provider-agnostic conventions.
---

## Philosophy

Kubernetes manifests describe desired state, not imperative instructions. Write them to be readable by a human who has never seen the cluster — every field should have a clear reason to exist. Keep manifests provider-agnostic: no cloud-vendor-specific annotations unless the user explicitly targets a specific cloud.

The foundation is always Docker. Kubernetes orchestrates containers, but the container image is the unit of deployment. If the Dockerfile is wrong, no amount of manifest tuning will fix it. Manifests come after images.

---

## When to use Kubernetes

Before producing any manifests, assess whether Kubernetes is the right tool. Do not generate manifests as a default — recommend and confirm with the user first.

**Kubernetes is likely appropriate when:**

- The monorepo has **3 or more independently deployable services**
- Services have **different scaling characteristics** (some need more replicas, some do not)
- The team needs **independent deployment cycles** per service
- There is a requirement for **zero-downtime deployments** and rollback at the service level
- The project already has Kubernetes configuration in any form

**Kubernetes is likely premature when:**

- There is only one service, or all services scale uniformly
- A `docker-compose.yml` is sufficient for production (small teams, low traffic, single host)
- The team has no Kubernetes operational experience

When in doubt, say so. Present the assessment and ask the user to confirm before writing any manifests.

---

## Repository layout

Manifests live in a `k8s/` directory at the monorepo root, organised by service:

```
k8s/
  base/
    namespace.yaml
  services/
    api/
      deployment.yaml
      service.yaml
      configmap.yaml
      hpa.yaml
    worker/
      deployment.yaml
      service.yaml
```

Keep a `base/` directory for cluster-wide resources (namespace, RBAC, shared network policies). Each service gets its own subdirectory.

---

## Namespace

Always deploy into a named namespace — never `default`.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: myapp
  labels:
    app.kubernetes.io/managed-by: kubectl
```

---

## Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: myapp
  labels:
    app.kubernetes.io/name: api
    app.kubernetes.io/component: backend
    app.kubernetes.io/part-of: myapp
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0 # zero-downtime: never remove a pod before a new one is ready
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api
        app.kubernetes.io/component: backend
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
      containers:
        - name: api
          image: myapp/api:1.0.0 # never use :latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3000
              name: http
          envFrom:
            - configMapRef:
                name: api-config
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: api-secrets
                  key: database-url
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 10
            periodSeconds: 15
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
      terminationGracePeriodSeconds: 30
```

---

## Required fields and rules

**Resource limits** — required on every container, no exceptions. A container without limits can starve its neighbours.

```yaml
resources:
  requests:
    cpu: 100m # guaranteed allocation
    memory: 128Mi
  limits:
    cpu: 500m # hard ceiling
    memory: 512Mi
```

Start with conservative limits based on the service's actual usage, not guesses. Document the basis in a comment if it is non-obvious.

**Liveness probe** — answers "is the process alive?". A failing liveness probe restarts the container.

**Readiness probe** — answers "is the process ready for traffic?". A failing readiness probe removes the pod from the Service endpoints without restarting it. Both are required. They may hit the same endpoint, but they should ideally be distinct: `/health` for liveness, `/ready` for readiness.

**Image tag** — never use `:latest`. Use the explicit application version or git SHA.

**`runAsNonRoot: true`** — required on all pods. Matches the non-root user set in the Dockerfile.

**`readOnlyRootFilesystem: true`** — preferred. If the application writes to the filesystem, mount an explicit `emptyDir` volume for those paths rather than disabling this.

---

## Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: myapp
  labels:
    app.kubernetes.io/name: api
spec:
  selector:
    app.kubernetes.io/name: api
  ports:
    - name: http
      port: 80
      targetPort: http
  type: ClusterIP # default; use LoadBalancer only for external entry points
```

Use `ClusterIP` for internal service-to-service communication. Use `LoadBalancer` only for services that receive external traffic and only when no ingress controller is in use. Prefer `Ingress` for HTTP/HTTPS traffic.

---

## ConfigMap (non-secret configuration)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
  namespace: myapp
data:
  NODE_ENV: 'production'
  PORT: '3000'
  LOG_LEVEL: 'info'
```

Only non-sensitive values go in ConfigMaps. Secrets go in `kind: Secret` (or an external secrets operator).

---

## Secrets

Never commit secret values to the repository. Reference the Secret object in the manifest, but do not define its `data` values in version-controlled files.

```yaml
# k8s/services/api/secret.yaml — committed (structure only, no values)
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
  namespace: myapp
type: Opaque
# data values are applied out-of-band (CI/CD pipeline, external secrets operator)
```

Document in a `k8s/README.md` how secrets are populated in each environment.

---

## HorizontalPodAutoscaler

Add an HPA for any service that could benefit from elastic scaling. Do not add one speculatively — only when there is a scaling requirement.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
  namespace: myapp
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

Set `minReplicas` to at least 2 for any service that must be highly available.

---

## Labels

Use the standard Kubernetes recommended labels on all objects:

```yaml
labels:
  app.kubernetes.io/name: api # name of the application component
  app.kubernetes.io/component: backend # role (backend, frontend, worker, cache)
  app.kubernetes.io/part-of: myapp # the parent application
  app.kubernetes.io/version: '1.0.0' # current version (on pods/deployments)
  app.kubernetes.io/managed-by: kubectl # or helm, argocd, etc.
```

Consistent labels enable `kubectl get all -l app.kubernetes.io/part-of=myapp` to surface everything related to the application.

---

## Rolling update strategy

The default strategy is `RollingUpdate` with `maxUnavailable: 0`. This guarantees that traffic is always served during deploys. Only deviate from this with explicit justification.

`Recreate` (stop all pods, then start new ones) is appropriate only for jobs or stateful services that cannot run two versions simultaneously, and only when downtime is acceptable.

---

## Provider-agnostic conventions

Keep manifests free of cloud-specific annotations unless the user has confirmed a target platform:

- No `kubernetes.io/ingress.class: alb` (AWS-specific)
- No `cloud.google.com/*` annotations unless on GKE
- No Azure-specific labels

Prefer `nginx` as the assumed ingress class when an ingress is needed — it runs identically on every cluster and locally via minikube or kind.

---

## Checklist

Before finalising any set of manifests:

- [ ] Kubernetes assessed as appropriate for this project (not blindly generated)
- [ ] All resources are in a named namespace, not `default`
- [ ] Every container has `resources.requests` and `resources.limits` set
- [ ] Every Deployment has both `livenessProbe` and `readinessProbe`
- [ ] Image tags are pinned versions, never `:latest`
- [ ] Pods run as non-root (`runAsNonRoot: true`)
- [ ] No secret values are committed — `Secret` objects are structural only
- [ ] Rolling update strategy has `maxUnavailable: 0`
- [ ] No cloud-vendor-specific annotations (unless user confirmed target platform)
- [ ] Standard `app.kubernetes.io/*` labels on all objects
- [ ] A `k8s/README.md` describes how to apply the manifests and how secrets are populated
