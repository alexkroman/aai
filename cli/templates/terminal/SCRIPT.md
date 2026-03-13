# Kubernetes Terminal - Demo Script

Commands to speak into the microphone to show off the STT-driven terminal.

## Start: check the notes

- `cat notes.txt`

## TODO 1: Fix the CrashLoopBackOff on api-server pod

- `kubectl get pods`
- `kubectl describe pod api-server`
- `kubectl logs api-server`
- `kubectl rollout restart deployment api-server`

## TODO 2: Investigate ImagePullBackOff on worker pod in app namespace

- `kubectl get pods -n app`
- `kubectl describe pod worker -n app`
