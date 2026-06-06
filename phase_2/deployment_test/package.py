import os
import tarfile
import shutil
import tensorflow as tf
import boto3

# --- Configuration ---
TAR_NAME = 'model_v3.tar.gz'
S3_BUCKET = 'sagemaker-studio-i0gutcxdy'
S3_PREFIX = 'frustration-model/models'

s3 = boto3.client('s3')

# 1. Clean up old build directories if they exist locally
for d in ['1', 'code']:
    if os.path.exists(d):
        shutil.rmtree(d)

os.makedirs('1', exist_ok=True)
os.makedirs('code', exist_ok=True)

# 2. Download the artifacts directly from your S3 bucket
print("Downloading artifacts directly from S3...")
artifacts_to_download = [
    'autoencoder_model.keras',
    'isolation_forest.pkl',
    'scaler.pkl',
    'model_metadata.joblib'
]

for artifact in artifacts_to_download:
    print(f" -> Pulling {artifact}...")
    s3.download_file(S3_BUCKET, f"{S3_PREFIX}/{artifact}", artifact)

# 3. Convert Keras model to SavedModel format
print("\nConverting autoencoder_model.keras to SavedModel format...")
# 3. Convert Keras model to SavedModel format
print("\nConverting autoencoder_model.keras to SavedModel format...")
try:
    model = tf.keras.models.load_model('autoencoder_model.keras')
    
    # Try the newer Keras export method first
    if hasattr(model, 'export'):
        model.export('1')
    else:
        # Fallback for slightly older TF versions
        model.save('1', save_format='tf')
        
    print("Successfully created SavedModel bundle in '1/' directory.")
except Exception as e:
    print(f"Error converting model: {e}")

# 4. Gather inference script and Scikit-Learn artifacts into the 'code' directory

print("\nStaging files into 'code/' directory...")

files_to_package = [
    'inference.py',
    'requirements.txt',
    'isolation_forest.pkl',
    'scaler.pkl',
    'model_metadata.joblib'
]

for file_name in files_to_package:
    if os.path.exists(file_name):
        shutil.copy(file_name, os.path.join('code', file_name))
        print(f" -> Copied {file_name}")
    else:
        print(f" ⚠️ WARNING: {file_name} not found! Check your spelling.")

# 5. Create the final tarball
print(f"\nPackaging everything into {TAR_NAME}...")
with tarfile.open(TAR_NAME, mode='w:gz') as archive:
    archive.add('1', arcname='1')       
    archive.add('code', arcname='code') 

print(f"Successfully packaged {TAR_NAME}!")

# 6. Upload directly to S3
print(f"\nUploading {TAR_NAME} back to S3...")
s3.upload_file(TAR_NAME, S3_BUCKET, f"{S3_PREFIX}/{TAR_NAME}")
print(f"Upload complete! -> s3://{S3_BUCKET}/{S3_PREFIX}/{TAR_NAME}")

# 7. Print the structure to verify it's perfect
print("\nVerifying Tarball Structure:")
with tarfile.open(TAR_NAME, 'r:gz') as tar:
    for member in tar.getmembers():
        print(f" - {member.name}")