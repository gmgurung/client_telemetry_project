# Telemetry Pipeline: Phase 2 AI & Model Engineering Presentation Script

*Total Estimated Time: ~3 to 3.5 minutes (approx. 430 words).*

---

## 🎤 Introduction (Slide 7: Architecture Diagram)
*(Estimated time: 30 seconds)*

**The Script:**
> "Welcome to Phase 2 of the Vanguard Client Telemetry AI System. In this phase, our core objective was to take raw, unstructured telemetry from the frontend and transform it into actionable insights. As you can see in our architecture diagram, we built an end-to-end Machine Learning pipeline. Today, I’ll walk you through its three major components: Data Ingestion, Model Training, and Deployment."

---

## 🎤 Part 1: Data Ingestion & Preprocessing (Slide 8)
*(Estimated time: 45-60 seconds)*

**The Script:**
> "Let's start with Part 1: Data Ingestion and Preprocessing. Our system is built to handle raw telemetry in NDJSON format, seamlessly pulling from either AWS S3 or a local file system. One of our biggest technical wins was building an adaptable pipeline. This allows our system to ingest different telemetry formats without requiring any significant code changes.
>
> During preprocessing, we take this unstructured data and group individual events into cohesive user sessions. From there, we transform those events into 13 specific numerical features that mathematically quantify user frustration. Finally, this processed data is safely stored back into an S3 bucket, fully prepared for analytics and visualization."


## 🎤 Part 2: Model Training & Artifacts (Slide 9)
*(Estimated time: 45-60 seconds)*

**The Script:**
> "Moving on to Part 2: Model Training and Artifacts. To identify user frustration, we utilize an Ensemble approach. We combine an Autoencoder—to detect unusual patterns—with an Isolation Forest, which flags statistical outliers. 
>
> Because our features vary in scale, we implement strict data normalization so that high-magnitude features don't disrupt the predictions. We also built rigorous validation guardrails into our training pipeline to ensure that only the best, most stable models are allowed into production. Lastly, we enforce strict model versioning, guaranteeing we can safely switch or roll back to a previous model at any time."


## 🎤 Part 3: Deployment (Slide 10)
*(Estimated time: 45-60 seconds)*

**The Script:**
> "Finally, we arrive at Part 3: Deployment. For real-time execution, we deployed our models to an AWS SageMaker Endpoint, providing high-performance, scalable API requests. 
>
> However, to ensure maximum reliability, we also implemented local model syncing. If the API ever experiences downtime, our system falls back to scoring locally without any network overhead. To make the entire pipeline automated, we use event-driven AWS Lambda functions that continuously monitor S3 and trigger inference as soon as new data arrives. 
>
> At the end of the pipeline, our ensemble outputs a final 0 to 10 frustration score, which is translated into a classified severity label—Normal, Medium, or High—empowering stakeholders and customer service agents with clear and actionable insights."

