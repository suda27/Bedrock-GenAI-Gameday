# Optimizing AWS Lambda Performance and Cost

**Cold Starts:**  
Use Provisioned Concurrency for latency-sensitive workloads. It keeps functions initialized and ready to respond instantly.  
If low-latency is not critical, rely on on-demand execution to reduce cost.

**Memory and CPU Tuning:**  
Lambda allocates CPU power in proportion to memory. Increasing memory also improves CPU performance — test multiple configurations to find the sweet spot.

**Reduce Package Size:**  
Use Lambda Layers to separate dependencies. Keep deployment packages under 50 MB zipped.

**Connection Reuse:**  
Reuse SDK clients (like boto3) outside the handler. Avoid reinitializing them inside the function for each invocation.

**Monitoring:**  
Use CloudWatch metrics like `Duration`, `Invocations`, and `Throttles` to identify optimization opportunities.
