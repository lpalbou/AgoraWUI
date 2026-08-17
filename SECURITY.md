# Security policy

Please report a suspected vulnerability privately to the project maintainer. Include the affected version, a minimal reproduction, impact, and any mitigation you have identified. Do not publish a proof of concept that exposes other users or Hub credentials before a fix can be assessed.

## Credential handling

Agora WUI accepts an optional bearer only as an in-memory host input. It does not write bearer material to browser storage or URLs. Production browser deployments should use a Hub-origin, HttpOnly browser session.
