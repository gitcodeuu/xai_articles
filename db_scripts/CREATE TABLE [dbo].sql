CREATE TABLE [dbo].[ADF_Metadata] (
    PipelineName NVARCHAR(100) PRIMARY KEY,
    LastRunTime DATETIME2
);

-- Initialize once (optional)
INSERT INTO [dbo].[ADF_Metadata] (PipelineName, LastRunTime)
VALUES ('CopyJSONIncremental', '2025-10-24T00:00:00Z');