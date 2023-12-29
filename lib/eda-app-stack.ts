import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Creating a DynamoDB table to store image metadata
    const imageTable = new dynamodb.Table(this, "Images", {
      partitionKey: { name: "ImageName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      tableName: "Images",
    });

    // Creating an S3 bucket to store images
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });


      //Dead letter queue for rejection emails
    const rejectionQueue = new sqs.Queue(this, "RejectionMailerDLQ", {
      queueName: "RejectionMailerDLQ",
      retentionPeriod: cdk.Duration.minutes(10),

    });

    // Creating SQS queue for image processing
    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: rejectionQueue,
        maxReceiveCount: 5,
      },
    });

    // Creating an SNS topic for new images
    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    const imageChangeTopic = new sns.Topic(this, "ImageChangeTopic", {
      displayName: "Image Change topic",
    });



    // Creating Lambda functions for image processing and mailing
    const processImageFn = new lambdanode.NodejsFunction(
      this,
      "ProcessImageFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
      }
    );

    const confirmationMailerFn = new lambdanode.NodejsFunction(this, "confirmation-mailer-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
    });

    const rejectionMailerFn = new lambdanode.NodejsFunction(this, "rejection-mailer-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
    });

    const processUpdateFn = new lambdanode.NodejsFunction(this, "process-update-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/processUpdate.ts`,
    });

    const processDeleteFn = new lambdanode.NodejsFunction(this, "process-delete-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/processDelete.ts`,
    });


    // Setting up event triggers and subscriptions
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    //Add attributes to the bucket event
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.SnsDestination(imageChangeTopic),
    );

    newImageTopic.addSubscription(new subs.LambdaSubscription(confirmationMailerFn)); // Subscribe confirmationMailerFn to the SNS topic

    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue) // Subscribe imageProcessQueue to the SNS topic
    );
    
    rejectionMailerFn.addEventSource(new events.SqsEventSource(rejectionQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
      maxConcurrency: 5
    }));


    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });

    processImageFn.addEventSource(newImageEventSource);

    // // Filter the change sns topic to only send updates
    // const imageChangeFilter: sns.SubscriptionFilter = {
    //   conditions: ["ImageRemoved"],
    // };

    // const imageChangeEventSource = new events.SnsEventSource(imageChangeTopic, {
    //   filterPolicy: {imageChangeFilter},
    // });

    // processUpdateFn.addEventSource(imageChangeEventSource);

    // Filter the change sns topic to only send deletes


    // const filterPolicy: sns.SubscriptionFilter= {
    //   'Records': [
    //     {
    //       'eventName': sns.SubscriptionFilter.stringFilter({
    //         allowlist: ['ObjectRemoved:Delete'],
    //       }),
    //     },
    //   ],
    // };
    
    // I cannot figure out how to get a subsciption filter to work with a bucket created event, since it doesnt have any attributes to filter on.
    const imageDeleteEventSource = new events.SnsEventSource(imageChangeTopic);

    
    
    
    

    processDeleteFn.addEventSource(imageDeleteEventSource);

    // Assigning permissions
    imagesBucket.grantRead(processImageFn);

    imageTable.grantReadWriteData(processImageFn); //Granting DynamoDB permissions to processImageFn
    imageTable.grantReadWriteData(processUpdateFn); //Granting DynamoDB permissions to processUpdateFn
    imageTable.grantReadWriteData(processDeleteFn); //Granting DynamoDB permissions to processDeleteFn

    rejectionQueue.grantConsumeMessages(rejectionMailerFn); // Granting permissions to rejectionMailerFn to consume messages from rejectionQueue

    confirmationMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    rejectionMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    // Outputting the S3 bucket name
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });
  }
}
