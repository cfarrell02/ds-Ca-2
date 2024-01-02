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
import { StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import {  DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
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
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
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
      retentionPeriod: cdk.Duration.days(14),

    });

    // Creating SQS queue for image processing
    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(2),
      deadLetterQueue: {
        queue: rejectionQueue,
        maxReceiveCount: 1,
      },
    });

    // Creating an SNS topic for new images
    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
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

    // const confirmationMailerFn = new lambdanode.NodejsFunction(this, "confirmation-mailer-function", {
    //   runtime: lambda.Runtime.NODEJS_18_X,
    //   memorySize: 1024,
    //   timeout: cdk.Duration.seconds(3),
    //   entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
    // });

    const addDeleteMailerFn = new lambdanode.NodejsFunction(this, "add-delete-mailer-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/addDeleteMailer.ts`,
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


    // Add deleteAddmailer fn to a dynamoDB EventSource

    const tableEventSource = new DynamoEventSource(imageTable, {
      startingPosition: StartingPosition.LATEST,
      batchSize: 5,
      // filters: [
      //   lambda.FilterCriteria.filter({
      //     eventName: lambda.FilterRule.isEqual("INSERT"),

      //     }),     
      //    ]
    });

    addDeleteMailerFn.addEventSource(tableEventSource);


    // Setting up event triggers and subscriptions
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    // //Add attributes to the bucket event
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.SnsDestination(newImageTopic),
    );


    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue), // Subscribe imageProcessQueue to the SNS topic
    );
    
    rejectionMailerFn.addEventSource(new events.SqsEventSource(rejectionQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
      maxConcurrency: 5
    }));


    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
      // filters:[
        // lambda.FilterCriteria.filter({
        //   eventName:
        // })
      // ],
    });

    processImageFn.addEventSource(newImageEventSource);


    const imageChangeEventSource = new events.SnsEventSource(newImageTopic, {
      filterPolicy: {
        'comment_type': sns.SubscriptionFilter.stringFilter({
          allowlist: ['Caption']
        })
      }
    });

    processUpdateFn.addEventSource(imageChangeEventSource);

    
    const imageDeleteEventSource = new events.SnsEventSource(newImageTopic,{
      filterPolicyWithMessageBody:{
          Records: sns.FilterOrPolicy.policy(
            {
              eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
                matchPrefixes: ['ObjectRemoved']
              })),
            }
          )
      }
    });

    
    

    processDeleteFn.addEventSource(imageDeleteEventSource);

    // Assigning permissions
    imagesBucket.grantRead(processImageFn);

    imageTable.grantReadWriteData(processImageFn); //Granting DynamoDB permissions to processImageFn
    imageTable.grantReadWriteData(processUpdateFn); //Granting DynamoDB permissions to processUpdateFn
    imageTable.grantReadWriteData(processDeleteFn); //Granting DynamoDB permissions to processDeleteFn

    rejectionQueue.grantConsumeMessages(rejectionMailerFn); // Granting permissions to rejectionMailerFn to consume messages from rejectionQueue

    addDeleteMailerFn.addToRolePolicy(
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
    new cdk.CfnOutput(this, "newImageTopicARN", {
      value: newImageTopic.topicArn,
    });
  }
}
