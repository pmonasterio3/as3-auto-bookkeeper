# Lambda Layer Build for AS3 Bookkeeper
# SAM invokes this with ARTIFACTS_DIR set to the output directory

build-CommonLayer:
	# Install Python dependencies
	pip install -r requirements.txt -t $(ARTIFACTS_DIR)/python/
	# Copy custom packages
	cp -r python/utils $(ARTIFACTS_DIR)/python/
	cp -r python/models $(ARTIFACTS_DIR)/python/
